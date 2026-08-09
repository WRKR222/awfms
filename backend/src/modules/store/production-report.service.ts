// src/modules/store/production-report.service.ts
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { UserRole, NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { RequestUser } from '../../auth/types/request-user.type';
import { ProductionReportParserService } from './production-report-parser.service';
import { ProductionReportReconciliationService } from './production-report-reconciliation.service';
import { ProductionReportRollbackService, RollbackResult } from './production-report-rollback.service';
import {
  CANONICAL_FIELD_LABELS, CanonicalField, ProductionReportColumnMapping, SubmitReportResult, PreviewReportResult,
} from './production-report.dto';

@Injectable()
export class ProductionReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ProductionReportParserService,
    private readonly reconciler: ProductionReportReconciliationService,
    private readonly rollbackService: ProductionReportRollbackService,
    private readonly notifications: NotificationsService,
  ) {}

  async detectHeaders(buffer: Buffer) {
    return this.parser.detectHeaders(buffer);
  }

  /** Step 1b's "did I read your file correctly" screen — the FULL parsed
   *  table (no 30-row cap: Store reviews the whole report, not a sample),
   *  non-mutating, with the set of columns that actually carry data so the
   *  frontend renders "fit to window, only recorded columns" per §2. */
  async preview(buffer: Buffer, mapping: ProductionReportColumnMapping): Promise<PreviewReportResult> {
    const rows = this.parser.parseRows(buffer, mapping);

    const presentFields = (Object.keys(CANONICAL_FIELD_LABELS) as CanonicalField[]).filter(
      f => mapping.fields[f] != null && rows.some(r => (r as any)[f] !== undefined && (r as any)[f] !== null && (r as any)[f] !== ''),
    );

    const itemIds = Object.keys(mapping.items ?? {});
    let presentItemColumns: PreviewReportResult['presentItemColumns'] = [];
    if (itemIds.length) {
      const items = await this.prisma.storeItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } });
      const nameById = new Map(items.map(i => [i.id, i.name]));
      presentItemColumns = itemIds
        .filter(id => rows.some(r => r.itemsIssued.some(u => u.storeItemId === id)))
        .map(id => ({ storeItemId: id, storeItemName: nameById.get(id) ?? '(unknown item)', header: mapping.items[id] }));
    }

    return { rows, totalRows: rows.length, presentFields, presentItemColumns };
  }

  /** Store rejects the parsed table at the verify step (§2a) before any
   *  reconciliation has run — nothing was ever written, so this is a pure
   *  audit-trail entry, not a state rollback. */
  async discardPreview(batchId: string, fileName: string, mapping: ProductionReportColumnMapping, user: RequestUser) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { id: true, batchCode: true } });
    if (!batch) throw new NotFoundException('Batch not found');

    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'PRODUCTION_REPORT_UPLOAD_REJECTED',
        entityType: 'Batch',
        entityId: batchId,
        newValues: { fileName, mapping } as any,
      },
    });

    return { discarded: true };
  }

  /**
   * Store submits (or re-submits) the current production report for a batch
   * — always called only after Store has clicked Approve & Submit on the
   * reviewed table from preview() (§2a: the frontend enforces this by only
   * exposing the button after preview succeeds). Parses + reconciles
   * immediately: anything that doesn't conflict with existing data is
   * applied right away; only genuine conflicts wait on the Director.
   * Re-uploading a batch's report replaces the previous one.
   */
  async submit(
    batchId: string,
    buffer: Buffer,
    mapping: ProductionReportColumnMapping,
    fileName: string,
    user: RequestUser,
  ): Promise<SubmitReportResult> {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const parsedRows = this.parser.parseRows(buffer, mapping);
    if (parsedRows.length === 0) throw new BadRequestException('No usable rows found in the file — check the column mapping.');

    const { rows, discrepancies, appliedChanges, autofillCount, matchedCount, stage } =
      await this.reconciler.reconcile(batchId, parsedRows, user.id, fileName);

    const status = discrepancies.length > 0 ? 'PENDING' : 'APPROVED';
    const existing = await this.prisma.storeProductionReport.findUnique({ where: { batchId } });
    const now = new Date();

    const report = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.storeProductionReport.upsert({
        where: { batchId },
        create: {
          batchId, fileName, columnMapping: mapping as any, rawRows: rows as any,
          status, discrepancyCount: discrepancies.length, autofillCount, matchedCount,
          uploadedById: user.id, appliedAt: now,
          storeVerifiedById: user.id, storeVerifiedAt: now,
        },
        update: {
          fileName, columnMapping: mapping as any, rawRows: rows as any,
          status, discrepancyCount: discrepancies.length, autofillCount, matchedCount,
          uploadedById: user.id, uploadedAt: now,
          resubmissionCount: { increment: 1 },
          reviewedById: null, reviewedAt: null, rejectionReason: null,
          appliedAt: now,
          storeVerifiedById: user.id, storeVerifiedAt: now,
        },
      });

      // Discrepancies are always recomputed fresh against the current report.
      await tx.productionReportDiscrepancy.deleteMany({ where: { reportId: saved.id } });
      if (discrepancies.length) {
        await tx.productionReportDiscrepancy.createMany({
          data: discrepancies.map(d => ({
            reportId: saved.id,
            rowDate: new Date(d.rowDate),
            field: d.field,
            discrepancyType: d.discrepancyType,
            locationRef: d.locationRef,
            systemValue: d.systemValue,
            reportValue: d.reportValue,
            notes: d.notes,
          })),
        });
      }

      // Applied-change ledger — every write reconcile() just made, so this
      // report's effects can be rolled back later (see
      // ProductionReportRollbackService). Accumulates across resubmissions
      // of the same batch's report (the report row's id is stable across
      // re-uploads), which is what makes "roll back my current report"
      // undo everything it has ever auto-filled, not just the latest pass.
      if (appliedChanges.length) {
        await tx.productionReportAppliedChange.createMany({
          data: appliedChanges.map(c => ({
            reportId: saved.id,
            batchId: c.batchId,
            rowDate: new Date(c.rowDate),
            entityType: c.entityType,
            entityId: c.entityId,
            action: c.action,
            beforeState: c.beforeState as any,
            afterState: c.afterState as any,
          })),
        });
      }

      return saved;
    });

    if (discrepancies.length > 0) {
      await this.notifications.notifyRole(
        UserRole.OWNER,
        NotificationType.PRODUCTION_REPORT_DISCREPANCY,
        `Production report discrepancy — ${batch.batchCode}`,
        `${existing ? 'Re-uploaded' : 'Uploaded'} report for ${batch.batchCode} has ${discrepancies.length} mismatch(es) against recorded data and needs your review.`,
        { entityId: report.id, entityType: 'StoreProductionReport' },
      ).catch(() => {});
    } else {
      await this.notifications.notifyRole(
        UserRole.OWNER,
        NotificationType.PRODUCTION_REPORT_SUBMITTED,
        `Production report applied — ${batch.batchCode}`,
        `Report for ${batch.batchCode} matched or auto-filled cleanly (${autofillCount} auto-filled, ${matchedCount} matched) — no review needed.`,
        { entityId: report.id, entityType: 'StoreProductionReport' },
      ).catch(() => {});
    }

    return {
      reportId: report.id,
      status: report.status as any,
      totalRows: rows.length,
      matchedCount,
      autofillCount,
      discrepancyCount: discrepancies.length,
      stage,
    };
  }

  async getByBatch(batchId: string) {
    const report = await this.prisma.storeProductionReport.findUnique({
      where: { batchId },
      include: {
        discrepancies: { orderBy: { rowDate: 'desc' } },
        uploadedBy: { select: { fullName: true } },
        reviewedBy: { select: { fullName: true } },
        storeVerifiedBy: { select: { fullName: true } },
        batch: { select: { batchCode: true } },
      },
    });
    if (!report) throw new NotFoundException('No production report has been uploaded for this batch yet');
    return report;
  }

  async listPending() {
    return this.prisma.storeProductionReport.findMany({
      where: { status: 'PENDING' },
      include: {
        batch: { select: { batchCode: true } },
        uploadedBy: { select: { fullName: true } },
        discrepancies: true,
      },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async listAll() {
    return this.prisma.storeProductionReport.findMany({
      include: {
        batch: { select: { batchCode: true } },
        uploadedBy: { select: { fullName: true } },
      },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /** Director trusts the report over the system for every currently open
   *  discrepancy on this report — each gets an adjusting entry applied (see
   *  ProductionReportReconciliationService.applyDiscrepancy), and the report
   *  moves to APPROVED once none remain unresolved. */
  async approve(reportId: string, user: RequestUser) {
    if (user.role !== UserRole.OWNER) throw new ForbiddenException('Only the Director may approve a production report');

    const report = await this.prisma.storeProductionReport.findUnique({
      where: { id: reportId },
      include: { discrepancies: { where: { resolved: false } } },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== 'PENDING') throw new BadRequestException('Only a report with open discrepancies needs approval');

    const results: string[] = [];
    for (const d of report.discrepancies) {
      const outcome = await this.reconciler.applyDiscrepancy(
        { rowDate: d.rowDate, field: d.field, discrepancyType: d.discrepancyType, locationRef: d.locationRef, systemValue: d.systemValue, reportValue: d.reportValue },
        report.batchId,
        user.id,
      );
      await this.prisma.productionReportDiscrepancy.update({
        where: { id: d.id },
        data: {
          resolved: true,
          resolution: outcome.applied ? 'APPLIED' : 'NEEDS_MANUAL_CORRECTION',
          resolvedById: user.id,
          resolvedAt: new Date(),
          notes: [d.notes, outcome.note].filter(Boolean).join(' — '),
        },
      });
      results.push(outcome.note);
    }

    const stillUnresolved = await this.prisma.productionReportDiscrepancy.count({
      where: { reportId, resolved: false },
    });

    const updated = await this.prisma.storeProductionReport.update({
      where: { id: reportId },
      data: stillUnresolved === 0
        ? { status: 'APPROVED', reviewedById: user.id, reviewedAt: new Date(), appliedAt: new Date() }
        : { reviewedById: user.id, reviewedAt: new Date() },
    });

    await this.notifications.notifyRole(
      UserRole.STORE, NotificationType.PRODUCTION_REPORT_APPROVED,
      'Production report approved',
      `Your production report has been reviewed and approved.${stillUnresolved ? ` ${stillUnresolved} item(s) still need manual reconciliation with the Director.` : ''}`,
      { entityId: reportId, entityType: 'StoreProductionReport' },
    ).catch(() => {});

    return { report: updated, results };
  }

  /** Director rejects the report outright — nothing further is applied, and
   *  Store must correct and re-upload (which recomputes everything fresh). */
  async reject(reportId: string, reason: string, user: RequestUser) {
    if (user.role !== UserRole.OWNER) throw new ForbiddenException('Only the Director may reject a production report');
    if (!reason?.trim()) throw new BadRequestException('A rejection reason is required');

    const report = await this.prisma.storeProductionReport.findUnique({ where: { id: reportId }, include: { batch: true } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== 'PENDING') throw new BadRequestException('Only a report with open discrepancies can be rejected');

    const updated = await this.prisma.storeProductionReport.update({
      where: { id: reportId },
      data: { status: 'REJECTED', rejectionReason: reason, reviewedById: user.id, reviewedAt: new Date() },
    });

    await this.notifications.notifyRole(
      UserRole.STORE, NotificationType.PRODUCTION_REPORT_REJECTED,
      `Production report rejected — ${report.batch.batchCode}`,
      `Reason: ${reason}. Please correct and re-upload.`,
      { entityId: reportId, entityType: 'StoreProductionReport' },
    ).catch(() => {});

    return updated;
  }

  /** Director (or Store, undoing their own upload) reverses everything the
   *  reconciliation engine auto-applied for this report — every daily log,
   *  stock-count, cage reassignment, and vaccine/supplement entry it
   *  created or corrected. Does NOT touch anything separately applied via
   *  approve()/applyDiscrepancy() — see ProductionReportRollbackService's
   *  header comment for why that's out of scope for this action. Safe to
   *  call once; a second call on the same report is rejected. */
  async rollback(reportId: string, user: RequestUser): Promise<RollbackResult> {
    const report = await this.prisma.storeProductionReport.findUnique({ where: { id: reportId }, include: { batch: true } });
    if (!report) throw new NotFoundException('Report not found');

    const result = await this.rollbackService.rollback(reportId, user);

    await this.notifications.notifyRole(
      UserRole.OWNER, NotificationType.PRODUCTION_REPORT_SUBMITTED,
      `Production report rolled back — ${report.batch.batchCode}`,
      `${result.reverted}/${result.totalChanges} auto-filled change(s) from this report were reversed.` +
        (result.skipped.length ? ` ${result.skipped.length} could not be reversed automatically (edited since) and need a manual look.` : ''),
      { entityId: reportId, entityType: 'StoreProductionReport' },
    ).catch(() => {});

    return result;
  }

  /** Director extracts the current report as a clean spreadsheet on request. */
  async exportReport(batchId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const report = await this.getByBatch(batchId);
    const rows = report.rawRows as any[];

    const wb = XLSX.utils.book_new();
    const sheetRows = rows.map(r => ({
      Date: r.date,
      Location: r.locationRef ?? '',
      'Feed (Kg)': r.feedKg ?? '',
      'Feed Type': r.feedType ?? '',
      'Water (L)': r.waterLts ?? '',
      Mortality: r.mortality ?? '',
      Culling: r.culling ?? '',
      'Opening Stock': r.openingStock ?? '',
      'Closing Stock': r.closingStock ?? '',
      'Avg Weight': r.avgWeight ?? '',
      Temp: r.temperature ?? '',
      Humidity: r.humidity ?? '',
      Lux: r.lux ?? '',
      'Drugs/Vaccines': r.drugsVaccines ?? '',
      Vaccine: r.vaccineText ?? '',
      Supplement: r.supplementText ?? '',
      Treatment: r.treatmentText ?? '',
      'Items Issued': (r.itemsIssued ?? []).map((i: any) => `${i.storeItemName}: ${i.quantity}${i.unit ?? ''}`).join(', '),
      'Health Usages': (r.healthUsages ?? []).map((h: any) => `${h.kind}: ${h.storeItemName ?? h.rawText}${h.quantity ? ` (${h.quantity}${h.unit ?? ''})` : ''}`).join(', '),
      Notes: r.notes ?? '',
      'Mortality Status': r.resolution?.mortality ?? '',
      'Feed Status': r.resolution?.feedKg ?? '',
      'Stock Status': r.resolution?.stockCount ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Production Report');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return { buffer, fileName: `${(report as any).batch.batchCode}-production-report.xlsx` };
  }
}
