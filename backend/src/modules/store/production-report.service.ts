// src/modules/store/production-report.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { UserRole, NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { RequestUser } from '../../auth/types/request-user.type';
import { ProductionReportParserService } from './production-report-parser.service';
import { ProductionReportReconciliationService, normaliseText } from './production-report-reconciliation.service';
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
    const headers = this.parser.getHeaders(buffer);

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

    return { rows, totalRows: rows.length, presentFields, presentItemColumns, headers };
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
    // Original sheet column order — persisted alongside rawRows so the
    // report table can render columns in the order the file actually had
    // them, regardless of jsonb's key-order-losing storage of rawRows
    // itself (see StoreProductionReport.rawHeaders in schema.prisma).
    const rawHeaders = this.parser.getHeaders(buffer);

    const { rows, discrepancies, appliedChanges, autofillCount, matchedCount, stage } =
      await this.reconciler.reconcile(batchId, parsedRows, user.id, fileName);

    const status = discrepancies.length > 0 ? 'PENDING' : 'APPROVED';
    const existing = await this.prisma.storeProductionReport.findUnique({ where: { batchId } });
    const now = new Date();

    const report = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.storeProductionReport.upsert({
        where: { batchId },
        create: {
          batchId, fileName, columnMapping: mapping as any, rawRows: rows as any, rawHeaders,
          status, discrepancyCount: discrepancies.length, autofillCount, matchedCount,
          uploadedById: user.id, appliedAt: now,
          storeVerifiedById: user.id, storeVerifiedAt: now,
        },
        update: {
          fileName, columnMapping: mapping as any, rawRows: rows as any, rawHeaders,
          status, discrepancyCount: discrepancies.length, autofillCount, matchedCount,
          uploadedById: user.id, uploadedAt: now,
          resubmissionCount: { increment: 1 },
          reviewedById: null, reviewedAt: null, rejectionReason: null,
          // A prior rejection may have rolled this report's applied changes
          // back (see reject() below) — a fresh upload starts a clean slate,
          // so it must be reversible again too, not permanently blocked by
          // the old rollback flag.
          rolledBackAt: null, rolledBackById: null,
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
            resolved: !!d.preResolved,
            resolution: d.preResolved ? 'APPLIED' : undefined,
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

    if (discrepancies.length === 0) {
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

  /** Store manually matches a report label the automatic matcher couldn't
   *  place (a "Could not match this ... to any store item" discrepancy) to
   *  an actual StoreItem. Saves it as a reusable StoreItemAlias — so the
   *  exact same sheet wording auto-matches on every future report from now
   *  on — then re-reconciles this batch's CURRENT report using its already-
   *  parsed rawRows (no re-upload/re-parse needed): whatever was blocked
   *  only by the missing match now applies immediately.
   *
   *  When the cell was genuinely blank (rawLabel has no real text —
   *  UnmatchedItemRow's "This cell had only whitespace" case), there's
   *  nothing to build a text alias FROM, so a rawLabel-keyed re-reconcile
   *  can never resolve it — every future blank cell needs re-matching too,
   *  which is correct: there's no text for it to match against next time.
   *  In that case `discrepancyId` closes out just that one discrepancy,
   *  recording the picked item for the audit trail without inventing an
   *  alias for empty text. */
  async matchItem(batchId: string, rawLabel: string, storeItemId: string, discrepancyId: string | undefined, user: RequestUser) {
    const [report, storeItem] = await Promise.all([
      this.prisma.storeProductionReport.findUnique({ where: { batchId }, include: { batch: { select: { batchCode: true } } } }),
      this.prisma.storeItem.findUnique({ where: { id: storeItemId } }),
    ]);
    if (!report) throw new NotFoundException('No production report has been uploaded for this batch yet');
    if (!storeItem) throw new NotFoundException('Store item not found');

    if (!rawLabel?.trim()) {
      if (!discrepancyId) throw new BadRequestException('rawLabel has no matchable text — pass discrepancyId to resolve a blank-cell discrepancy directly.');
      const discrepancy = await this.prisma.productionReportDiscrepancy.findUnique({ where: { id: discrepancyId } });
      if (!discrepancy || discrepancy.reportId !== report.id) throw new NotFoundException('Discrepancy not found on this report');
      if (discrepancy.resolved) throw new BadRequestException('This discrepancy is already resolved');

      const updatedDiscrepancy = await this.prisma.productionReportDiscrepancy.update({
        where: { id: discrepancyId },
        data: {
          resolved: true,
          resolution: 'APPLIED',
          resolvedById: user.id,
          resolvedAt: new Date(),
          notes: [discrepancy.notes, `Blank cell — Store confirmed no ${discrepancy.field} was actually given, closed against ${storeItem.name} for reference.`].filter(Boolean).join(' — '),
        },
      });

      const stillUnresolved = await this.prisma.productionReportDiscrepancy.count({ where: { reportId: report.id, resolved: false } });
      const updatedReport = await this.prisma.storeProductionReport.update({
        where: { id: report.id },
        data: stillUnresolved === 0 ? { status: 'APPROVED' } : {},
      });

      return { report: updatedReport, matchedItem: { id: storeItem.id, name: storeItem.name }, discrepancy: updatedDiscrepancy, discrepancyCount: stillUnresolved };
    }

    const normalisedAlias = normaliseText(rawLabel);
    if (!normalisedAlias) throw new BadRequestException('rawLabel has no matchable text');

    await this.prisma.storeItemAlias.upsert({
      where: { normalisedAlias },
      create: { normalisedAlias, rawAlias: rawLabel, storeItemId, createdById: user.id },
      update: { storeItemId, rawAlias: rawLabel }, // re-matching an existing label points it at a different item
    });

    const rows = report.rawRows as any;
    const { rows: reconciledRows, discrepancies, appliedChanges, autofillCount, matchedCount } =
      await this.reconciler.reconcile(batchId, rows, user.id, report.fileName);

    const status = discrepancies.length > 0 ? 'PENDING' : 'APPROVED';
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.storeProductionReport.update({
        where: { id: report.id },
        data: { rawRows: reconciledRows as any, status, discrepancyCount: discrepancies.length, autofillCount, matchedCount, appliedAt: now },
      });

      await tx.productionReportDiscrepancy.deleteMany({ where: { reportId: saved.id } });
      if (discrepancies.length) {
        await tx.productionReportDiscrepancy.createMany({
          data: discrepancies.map(d => ({
            reportId: saved.id, rowDate: new Date(d.rowDate), field: d.field, discrepancyType: d.discrepancyType,
            locationRef: d.locationRef, systemValue: d.systemValue, reportValue: d.reportValue, notes: d.notes,
            resolved: !!d.preResolved, resolution: d.preResolved ? 'APPLIED' : undefined,
          })),
        });
      }
      if (appliedChanges.length) {
        await tx.productionReportAppliedChange.createMany({
          data: appliedChanges.map(c => ({
            reportId: saved.id, batchId: c.batchId, rowDate: new Date(c.rowDate), entityType: c.entityType,
            entityId: c.entityId, action: c.action, beforeState: c.beforeState as any, afterState: c.afterState as any,
          })),
        });
      }
      return saved;
    });

    return { report: updated, matchedItem: { id: storeItem.id, name: storeItem.name }, autofillCount, matchedCount, discrepancyCount: discrepancies.length };
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

  /** Store (or Director) trusts the report over the system for every
   *  currently open discrepancy on this report — each gets an adjusting
   *  entry applied (see ProductionReportReconciliationService.
   *  applyDiscrepancy), and the report moves to APPROVED once none remain
   *  unresolved. No role check here beyond the PRODUCTION_REPORT_REVIEW
   *  permission the controller already enforces — that permission is
   *  granted to STORE precisely so Store can resolve its own reports
   *  end-to-end with no separate Director sign-off (see
   *  role-permissions.map.ts). A hardcoded OWNER-only check here would
   *  silently defeat that. */
  async approve(reportId: string, user: RequestUser) {
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

  /** Store (or Director) rejects the report outright — no separate
   *  Director sign-off required, same reasoning as approve() above.
   *  Rejecting also rolls back everything this report auto-applied (see
   *  ProductionReportRollbackService), so a rejected report leaves no
   *  trace in daily-log history — otherwise its auto-filled mortality/
   *  feed/etc. entries would sit there indistinguishable from an
   *  attendant's own records even though the report itself was thrown
   *  out. Best-effort: any entry an attendant has since hand-edited is
   *  left in place (reported back as `rollbackSkipped`) rather than
   *  silently overwritten. Store must correct and re-upload afterward
   *  (which recomputes everything fresh). */
  async reject(reportId: string, reason: string, user: RequestUser) {
    if (!reason?.trim()) throw new BadRequestException('A rejection reason is required');

    const report = await this.prisma.storeProductionReport.findUnique({ where: { id: reportId }, include: { batch: true } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== 'PENDING') throw new BadRequestException('Only a report with open discrepancies can be rejected');

    const updated = await this.prisma.storeProductionReport.update({
      where: { id: reportId },
      data: { status: 'REJECTED', rejectionReason: reason, reviewedById: user.id, reviewedAt: new Date() },
    });

    let rollbackSkipped: RollbackResult['skipped'] = [];
    let rollbackReverted = 0;
    if (!report.rolledBackAt) {
      try {
        const result = await this.rollbackService.rollback(reportId, user);
        rollbackSkipped = result.skipped;
        rollbackReverted = result.reverted;
      } catch (err: any) {
        // Nothing had been auto-applied yet (0 changes) or it was already
        // rolled back — not fatal to the rejection itself.
      }
    }

    await this.notifications.notifyRole(
      UserRole.STORE, NotificationType.PRODUCTION_REPORT_REJECTED,
      `Production report rejected — ${report.batch.batchCode}`,
      `Reason: ${reason}. ${rollbackReverted} auto-filled change(s) were reversed.` +
        (rollbackSkipped.length ? ` ${rollbackSkipped.length} could not be reversed (edited since) and need a manual look.` : '') +
        ` Please correct and re-upload.`,
      { entityId: reportId, entityType: 'StoreProductionReport' },
    ).catch(() => {});

    return { ...updated, rollbackReverted, rollbackSkipped };
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
