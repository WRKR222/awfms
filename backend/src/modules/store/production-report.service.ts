// src/modules/store/production-report.service.ts
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { UserRole, NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { RequestUser } from '../../auth/types/request-user.type';
import { ProductionReportParserService } from './production-report-parser.service';
import { ProductionReportReconciliationService } from './production-report-reconciliation.service';
import { ProductionReportColumnMapping, SubmitReportResult } from './production-report.dto';

@Injectable()
export class ProductionReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ProductionReportParserService,
    private readonly reconciler: ProductionReportReconciliationService,
    private readonly notifications: NotificationsService,
  ) {}

  async detectHeaders(buffer: Buffer) {
    return this.parser.detectHeaders(buffer);
  }

  async preview(buffer: Buffer, mapping: ProductionReportColumnMapping) {
    // Preview only — parses and shows the rows as they'd be read, but does
    // NOT run reconciliation (which writes to the system), so Store can
    // sanity-check the column mapping before anything is applied.
    const rows = this.parser.parseRows(buffer, mapping);
    return { rows: rows.slice(0, 30), totalRows: rows.length };
  }

  /**
   * Store submits (or re-submits) the current production report for a batch.
   * Parses + reconciles immediately: anything that doesn't conflict with
   * existing data is applied right away; only genuine conflicts wait on the
   * Director. Re-uploading a batch's report replaces the previous one.
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

    const { rows, discrepancies, autofillCount, matchedCount } =
      await this.reconciler.reconcile(batchId, parsedRows, user.id, fileName);

    const status = discrepancies.length > 0 ? 'PENDING' : 'APPROVED';
    const existing = await this.prisma.storeProductionReport.findUnique({ where: { batchId } });

    const report = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.storeProductionReport.upsert({
        where: { batchId },
        create: {
          batchId, fileName, columnMapping: mapping as any, rawRows: rows as any,
          status, discrepancyCount: discrepancies.length, autofillCount, matchedCount,
          uploadedById: user.id, appliedAt: new Date(),
        },
        update: {
          fileName, columnMapping: mapping as any, rawRows: rows as any,
          status, discrepancyCount: discrepancies.length, autofillCount, matchedCount,
          uploadedById: user.id, uploadedAt: new Date(),
          resubmissionCount: { increment: 1 },
          reviewedById: null, reviewedAt: null, rejectionReason: null,
          appliedAt: new Date(),
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
    };
  }

  async getByBatch(batchId: string) {
    const report = await this.prisma.storeProductionReport.findUnique({
      where: { batchId },
      include: {
        discrepancies: { orderBy: { rowDate: 'desc' } },
        uploadedBy: { select: { fullName: true } },
        reviewedBy: { select: { fullName: true } },
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
      'Items Issued': (r.itemsIssued ?? []).map((i: any) => `${i.storeItemName}: ${i.quantity}${i.unit ?? ''}`).join(', '),
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
