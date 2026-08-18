// src/modules/weight/bird-weight-report.service.ts
//
// PM-facing "upload a bird weight report" feature. The PM weighs a physical
// sample of birds outside the app (scale sheet, spreadsheet from a field
// tablet, etc.) and uploads it here instead of retyping every bird's weight
// into the Farm Events "Bird Weighing" form by hand. This service parses the
// sheet into per-batch/per-date samples (with individual per-bird weights
// when the sheet has them) and exposes an autofill lookup the Farm Events
// form calls once a batch + date is picked.
//
// Sheet format is deliberately flexible — recognised columns (case/space
// insensitive):
//   Date            (required)
//   Batch           (required — matched against Batch.batchCode)
//   Row / Deck      (optional — free-text location label)
//   Bird 1, Bird 2, … Bird N     — one column per sampled bird's weight (g)
//   Weights                      — fallback: one cell with comma/space
//                                   separated individual weights (g)
//   Sample Count                 — fallback aggregate: sample size without
//                                   individual weights
//   Total Weight (g)             — fallback aggregate: total weight without
//                                   individual weights
//   Average Weight (g)           — used only if neither of the above is
//                                   derivable
//
// Whichever of (individual weights) vs (sample count + total weight) vs
// (average weight alone) the sheet provides, the row is normalised down to
// { sampleCount, individualWeightsG, totalWeightG, averageWeightG } so every
// downstream consumer (autofill, BirdWeightSample creation) only ever has to
// deal with one shape.
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BirdWeightReportRow, BirdWeightReportPreview, WeightAutofillResult } from './weight.dto';
import dayjs from 'dayjs';

function normaliseHeader(h: string): string {
  return String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isBirdWeightColumn(header: string): boolean {
  return /^bird\d+$/.test(normaliseHeader(header));
}

function parseDateCell(raw: any): string | null {
  if (raw instanceof Date && !isNaN(raw.getTime())) return dayjs(raw).format('YYYY-MM-DD');
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const d = dayjs(s);
  return d.isValid() ? d.format('YYYY-MM-DD') : null;
}

@Injectable()
export class BirdWeightReportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Parse the uploaded sheet, resolve each row's batch code against real
   *  Batch records, persist the raw + parsed rows for audit/reuse, and
   *  return a preview the PM can review before relying on it for autofill.
   *  Nothing is written into BirdWeightSample / HealthEvent at this stage —
   *  that only happens when the PM actually submits a Farm Events entry
   *  using the autofilled values (see WeightController.autofill +
   *  ManagerCullingPage's "Upload Bird Weight Report" flow). */
  async uploadAndParse(buffer: Buffer, fileName: string, uploadedById: string): Promise<BirdWeightReportPreview> {
    const rows = this.parseSheet(buffer);
    if (rows.length === 0) {
      throw new BadRequestException(
        'No usable rows found. Expect columns for Date, Batch, and either individual "Bird 1..N" weight columns or a Sample Count + Total Weight (g) pair.',
      );
    }

    const batchCodes = [...new Set(rows.map(r => r.batchCode.trim().toUpperCase()).filter(Boolean))];
    const batches = await this.prisma.batch.findMany({
      where: { batchCode: { in: batchCodes }, deletedAt: null },
      select: { id: true, batchCode: true },
    });
    const byCode = new Map<string, string>(
      batches.map((b: { id: string; batchCode: string }) => [b.batchCode.toUpperCase(), b.id] as [string, string]),
    );

    const resolvedRows: BirdWeightReportRow[] = rows.map(r => {
      const batchId = byCode.get(r.batchCode.trim().toUpperCase());
      return { ...r, batchId, matched: !!batchId };
    });
    const unmatchedBatchCodes = [...new Set(resolvedRows.filter(r => !r.matched).map(r => r.batchCode))];

    const upload = await this.prisma.birdWeightReportUpload.create({
      data: {
        fileName,
        rows: resolvedRows as any,
        rowCount: resolvedRows.length,
        uploadedById,
      },
    });

    return { uploadId: upload.id, fileName, rows: resolvedRows, unmatchedBatchCodes };
  }

  /** Look up the most recent uploaded-report sample for a batch + exact
   *  date, for the Farm Events "Bird Weighing" form's autofill button. Only
   *  ever a suggestion — the PM still has to submit the Farm Event
   *  themselves, and can edit any autofilled value first. */
  async autofill(batchId: string, date: string): Promise<WeightAutofillResult> {
    const uploads = await this.prisma.birdWeightReportUpload.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25, // recent uploads only — plenty for "did the PM just upload this"
    });

    for (const upload of uploads) {
      const rows = (upload.rows as unknown as BirdWeightReportRow[]) ?? [];
      const match = rows.find(r => r.batchId === batchId && r.date === date);
      if (match) {
        return {
          found: true,
          sampleCount: match.sampleCount,
          individualWeightsG: match.individualWeightsG,
          totalWeightG: match.totalWeightG,
          averageWeightG: match.averageWeightG,
          sourceUploadId: upload.id,
          reportDate: match.date,
        };
      }
    }
    return { found: false };
  }

  async listUploads(limit = 20) {
    return this.prisma.birdWeightReportUpload.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, fileName: true, rowCount: true, uploadedById: true, createdAt: true },
    });
  }

  async getUpload(id: string) {
    const upload = await this.prisma.birdWeightReportUpload.findUnique({ where: { id } });
    if (!upload) throw new NotFoundException('Upload not found');
    return upload;
  }

  // ── Parsing ──────────────────────────────────────────────────────────────

  private parseSheet(buffer: Buffer): Omit<BirdWeightReportRow, 'matched' | 'batchId'>[] {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch {
      throw new BadRequestException('Could not parse file. Ensure it is a valid .xlsx, .xls, or .csv.');
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
    if (raw.length === 0) return [];

    const headerRow = (raw[0] as any[]).map(h => String(h ?? '').trim());
    const norm = headerRow.map(normaliseHeader);

    const dateIdx = norm.findIndex(h => h === 'date');
    const batchIdx = norm.findIndex(h => h === 'batch' || h === 'batchcode');
    const rowIdx = norm.findIndex(h => h === 'row' || h === 'deck' || h === 'rowdeck');
    const weightsIdx = norm.findIndex(h => h === 'weights' || h === 'individualweights');
    const sampleCountIdx = norm.findIndex(h => h === 'samplecount' || h === 'birdssampled');
    const totalWeightIdx = norm.findIndex(h => h === 'totalweightg' || h === 'totalweight');
    const avgWeightIdx = norm.findIndex(h => h === 'averageweightg' || h === 'avgweight' || h === 'averageweight');
    const birdColIdxs = headerRow
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => isBirdWeightColumn(h))
      .map(({ i }) => i);

    if (dateIdx === -1 || batchIdx === -1) {
      throw new BadRequestException('Sheet must have a "Date" column and a "Batch" column.');
    }

    const out: Omit<BirdWeightReportRow, 'matched' | 'batchId'>[] = [];

    for (let r = 1; r < raw.length; r++) {
      const line = raw[r] as any[];
      if (!line || line.every(c => String(c ?? '').trim() === '')) continue;

      const date = parseDateCell(line[dateIdx]);
      const batchCode = String(line[batchIdx] ?? '').trim();
      if (!date || !batchCode) continue;

      let individualWeightsG: number[] = [];

      if (birdColIdxs.length > 0) {
        individualWeightsG = birdColIdxs
          .map(i => Number(line[i]))
          .filter(n => Number.isFinite(n) && n > 0);
      } else if (weightsIdx !== -1 && String(line[weightsIdx] ?? '').trim()) {
        individualWeightsG = String(line[weightsIdx])
          .split(/[,;\s]+/)
          .map(s => Number(s.trim()))
          .filter(n => Number.isFinite(n) && n > 0);
      }

      let sampleCount: number;
      let totalWeightG: number;
      let averageWeightG: number;

      if (individualWeightsG.length > 0) {
        sampleCount = individualWeightsG.length;
        totalWeightG = Math.round(individualWeightsG.reduce((s, w) => s + w, 0));
        averageWeightG = Math.round((totalWeightG / sampleCount) * 100) / 100;
      } else if (sampleCountIdx !== -1 && totalWeightIdx !== -1 && Number(line[sampleCountIdx]) > 0) {
        sampleCount = Number(line[sampleCountIdx]);
        totalWeightG = Number(line[totalWeightIdx]);
        averageWeightG = Math.round((totalWeightG / sampleCount) * 100) / 100;
      } else if (avgWeightIdx !== -1 && Number(line[avgWeightIdx]) > 0) {
        // Weakest fallback — average only, no sample size known. Assume 1
        // so downstream consumers always have a valid sampleCount/total.
        averageWeightG = Number(line[avgWeightIdx]);
        sampleCount = sampleCountIdx !== -1 ? (Number(line[sampleCountIdx]) || 1) : 1;
        totalWeightG = Math.round(averageWeightG * sampleCount);
      } else {
        continue; // row has neither individual weights nor any usable aggregate — skip
      }

      out.push({
        date,
        batchCode,
        rowCode: rowIdx !== -1 ? String(line[rowIdx] ?? '').trim() || undefined : undefined,
        sampleCount,
        individualWeightsG,
        totalWeightG,
        averageWeightG,
      });
    }

    return out;
  }
}
