// src/modules/production/hdp-control.service.ts
//
// PM uploads a target Hen-Day Production % curve (a breed/standard control
// sheet) as PDF, Excel, Word, or — FIX — a photo/scan image. This service
// parses it into (period, target %) points — a day number or week number of
// production, per the chosen granularity — stores it as the single "active"
// control set (a new upload deactivates the previous one; history is kept,
// not deleted), and compares actual recorded HDP against it for a given batch.
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { RequestUser } from '../../auth/types/request-user.type';
import type { ParsedHdpControlPoint, UploadHdpControlsDto } from './hdp-control.dto';

// Header words that can label the "period" column (day/week number).
const PERIOD_HEADER_WORDS = ['week', 'day', 'period', 'age'];
// Header words that can label the "target %" column.
const PERCENT_HEADER_WORDS = ['hdp', 'hen day', 'hen-day', 'production %', 'target', '%'];

@Injectable()
export class HdpControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  // ── Upload ────────────────────────────────────────────────────────────

  async upload(file: Express.Multer.File, dto: UploadHdpControlsDto, user: RequestUser) {
    if (!file) throw new BadRequestException('No file uploaded');

    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    let sourceFormat: 'PDF' | 'XLSX' | 'DOCX' | 'IMAGE';
    let points: ParsedHdpControlPoint[];
    // FIX: only populated for IMAGE uploads — Claude's short summary of what
    // it read from the photo and how `notes` were factored in. Saved on the
    // record so the PM can sanity-check an AI-read table on screen.
    let aiInterpretation: string | null = null;

    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      sourceFormat = 'XLSX';
      points = this.parseSpreadsheet(file.buffer);
    } else if (ext === 'pdf') {
      sourceFormat = 'PDF';
      points = await this.parsePdf(file.buffer);
    } else if (ext === 'docx' || ext === 'doc') {
      sourceFormat = 'DOCX';
      points = await this.parseDocx(file.buffer);
    } else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
      // FIX: PMs often only have a phone photo of a printed breed-standard
      // table — read it with Claude's vision API instead of requiring a
      // PDF/Excel/Word re-transcription.
      sourceFormat = 'IMAGE';
      const result = await this.parseImage(file.buffer, file.mimetype, dto.notes);
      points = result.points;
      aiInterpretation = result.interpretation;
    } else {
      throw new BadRequestException(
        `Unsupported file type ".${ext}". Upload the HDP% control curve as .pdf, .xlsx/.xls/.csv, .docx, or an image (.png/.jpg/.jpeg/.webp/.gif).`,
      );
    }

    if (points.length === 0) {
      throw new BadRequestException(
        sourceFormat === 'IMAGE'
          ? `Could not find any (period, target %) values in this image. Claude's reading of it: ` +
            `"${aiInterpretation ?? 'no readable rows'}". Try a clearer photo, or upload the standard as PDF, Excel, or Word instead.`
          : 'Could not find any (period, target %) values in this file. Make sure it has a column/row for ' +
            'the day or week number and one for the target HDP%.',
      );
    }

    // Collapse duplicate period indices (keep the last one seen — mirrors
    // how a person skimming the sheet would resolve a repeated row).
    const byPeriod = new Map<number, number>();
    for (const p of points) byPeriod.set(p.periodIndex, p.targetHdpPercent);
    const dedupedPoints = [...byPeriod.entries()]
      .map(([periodIndex, targetHdpPercent]) => ({ periodIndex, targetHdpPercent }))
      .sort((a, b) => a.periodIndex - b.periodIndex);

    return this.prisma.$transaction(async (tx) => {
      // Only one control set is "active" at a time — deactivate the
      // previous one rather than deleting it, so the comparison history
      // stays auditable.
      await tx.hdpControlUpload.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });

      const upload = await tx.hdpControlUpload.create({
        data: {
          fileName: file.originalname,
          sourceFormat,
          granularity: dto.granularity,
          notes: dto.notes ?? null,
          aiInterpretation,
          isActive: true,
          uploadedById: user.id,
          points: { createMany: { data: dedupedPoints } },
        },
        include: { points: { orderBy: { periodIndex: 'asc' } } },
      });

      return upload;
    });
  }

  async getActive() {
    const upload = await this.prisma.hdpControlUpload.findFirst({
      where: { isActive: true },
      include: { points: { orderBy: { periodIndex: 'asc' } } },
    });
    return upload; // null is a valid "nothing uploaded yet" response
  }

  async listUploads() {
    return this.prisma.hdpControlUpload.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, fileName: true, sourceFormat: true, granularity: true,
        notes: true, aiInterpretation: true, isActive: true, createdAt: true, uploadedById: true,
        _count: { select: { points: true } },
      },
    });
  }

  // ── Comparison ────────────────────────────────────────────────────────

  /**
   * Compares actual recorded HDP% for a batch against the active control
   * curve, at whatever granularity the control was uploaded at (day or
   * week of production, counted from the batch's date of hatch — same
   * anchor convention as the brooder module's batchAgeWeeks()).
   */
  async getComparison(batchId: string) {
    const [batch, control] = await Promise.all([
      this.prisma.batch.findFirst({ where: { id: batchId, deletedAt: null } }),
      this.getActive(),
    ]);
    if (!batch) throw new NotFoundException('Batch not found');
    if (!control) {
      throw new NotFoundException(
        'No HDP% control curve has been uploaded yet. Ask the Production Manager to upload one.',
      );
    }

    const sessions = await this.prisma.eggCollectionSession.findMany({
      where: { batchId, deletedAt: null, henDayPercent: { not: null } },
      select: { sessionDate: true, henDayPercent: true },
      orderBy: { sessionDate: 'asc' },
    });

    const anchor = new Date(batch.dateOfHatch);
    anchor.setHours(0, 0, 0, 0);

    // Bucket every session's HDP% into its day-of-age or week-of-age.
    const buckets = new Map<number, number[]>();
    for (const s of sessions) {
      const d = new Date(s.sessionDate);
      d.setHours(0, 0, 0, 0);
      const ageDays = Math.floor((d.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24));
      const periodIndex = control.granularity === 'DAILY'
        ? Math.max(1, ageDays + 1)
        : Math.max(1, Math.floor(Math.max(0, ageDays) / 7) + 1);
      const arr = buckets.get(periodIndex) ?? [];
      arr.push(Number(s.henDayPercent));
      buckets.set(periodIndex, arr);
    }

    const actualByPeriod = new Map<number, number>();
    for (const [period, values] of buckets) {
      actualByPeriod.set(period, Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100);
    }

    const allPeriods = new Set<number>([
      ...control.points.map(p => p.periodIndex),
      ...actualByPeriod.keys(),
    ]);

    const rows = [...allPeriods].sort((a, b) => a - b).map(periodIndex => {
      const target = control.points.find(p => p.periodIndex === periodIndex)?.targetHdpPercent ?? null;
      const actual = actualByPeriod.get(periodIndex) ?? null;
      const targetNum = target !== null ? Number(target) : null;
      return {
        periodIndex,
        targetHdpPercent: targetNum,
        actualHdpPercent: actual,
        varianceHdpPercent: (targetNum !== null && actual !== null)
          ? Math.round((actual - targetNum) * 100) / 100
          : null,
      };
    });

    return {
      batchId,
      batchCode: batch.batchCode,
      granularity: control.granularity,
      controlUploadId: control.id,
      controlFileName: control.fileName,
      rows,
    };
  }

  // ── Parsers ───────────────────────────────────────────────────────────

  /** xlsx / xls / csv — find a period column and a target-% column by header, or fall back to the first two numeric columns. */
  private parseSpreadsheet(buffer: Buffer): ParsedHdpControlPoint[] {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch {
      throw new BadRequestException('Could not read this as a spreadsheet file.');
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
    return this.extractPointsFromRows(raw);
  }

  /** Scans rows for a header row naming period/percent columns; falls back to "first two numbers on the row". */
  private extractPointsFromRows(rows: any[][]): ParsedHdpControlPoint[] {
    let periodCol = -1;
    let percentCol = -1;

    for (const row of rows.slice(0, 5)) {
      row.forEach((cell, colIdx) => {
        const text = String(cell ?? '').toLowerCase().trim();
        if (!text) return;
        if (periodCol === -1 && PERIOD_HEADER_WORDS.some(w => text.includes(w))) periodCol = colIdx;
        if (percentCol === -1 && PERCENT_HEADER_WORDS.some(w => text.includes(w))) percentCol = colIdx;
      });
      if (periodCol !== -1 && percentCol !== -1) break;
    }

    const points: ParsedHdpControlPoint[] = [];
    for (const row of rows) {
      let periodVal: number | null = null;
      let percentVal: number | null = null;

      if (periodCol !== -1 && percentCol !== -1) {
        periodVal  = this.toPeriodNumber(row[periodCol]);
        percentVal = this.toPercentNumber(row[percentCol]);
      } else {
        // No recognizable header — take the first two numeric-looking cells.
        const nums = row
          .map(c => this.toRawNumber(c))
          .filter((n): n is number => n !== null);
        if (nums.length >= 2) { periodVal = Math.round(nums[0]); percentVal = nums[1]; }
      }

      if (periodVal !== null && percentVal !== null && periodVal > 0 && percentVal >= 0 && percentVal <= 100) {
        points.push({ periodIndex: periodVal, targetHdpPercent: percentVal });
      }
    }
    return points;
  }

  /** PDF — extract text with pdf-parse, then reuse the same line-based regex parsing as DOCX. */
  private async parsePdf(buffer: Buffer): Promise<ParsedHdpControlPoint[]> {
    let text: string;
    try {
      // pdf-parse's default export is a function; require() keeps this
      // resilient to the package's mixed CJS/ESM interop across versions.
      const pdfParse = require('pdf-parse');
      const result = await pdfParse(buffer);
      text = result.text ?? '';
    } catch (e) {
      throw new BadRequestException('Could not read text from this PDF. Try uploading it as Excel or Word instead.');
    }
    return this.extractPointsFromText(text);
  }

  /** DOCX — extract raw text with mammoth, then line-based regex parsing. */
  private async parseDocx(buffer: Buffer): Promise<ParsedHdpControlPoint[]> {
    let text: string;
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value ?? '';
    } catch (e) {
      throw new BadRequestException('Could not read text from this Word document. Try uploading it as Excel or PDF instead.');
    }
    return this.extractPointsFromText(text);
  }

  /**
   * Image (png/jpg/jpeg/webp/gif) — FIX: hands the photo to
   * AiService.transcribeHdpControlImage(), which reads the table with
   * Claude's vision API and returns "Week N: X%" style lines plus a short
   * interpretation. Those lines are then fed through the exact same
   * extractPointsFromText() regex parser the PDF/DOCX paths already use,
   * so there's no separate table-extraction logic to maintain for images.
   */
  private async parseImage(
    buffer: Buffer, mimeType: string, notes: string | undefined,
  ): Promise<{ points: ParsedHdpControlPoint[]; interpretation: string | null }> {
    const result = await this.aiService.transcribeHdpControlImage(buffer, mimeType, notes);
    if (!result) {
      throw new BadRequestException(
        'Could not read this image right now (the AI reader is unavailable or the request failed). ' +
        'Try again in a moment, or upload the standard as PDF, Excel, or Word instead.',
      );
    }
    const points = this.extractPointsFromText(result.transcription);
    return { points, interpretation: result.interpretation };
  }

  /**
   * Best-effort line parser for free-form PDF/Word text — looks for lines
   * like "Week 3: 92.5%", "Day 15 - 88", "3   92.5%", "Week 3 | 92.5".
   * Every line is checked independently; lines that don't match are skipped.
   */
  private extractPointsFromText(text: string): ParsedHdpControlPoint[] {
    const points: ParsedHdpControlPoint[] = [];
    const lines = text.split(/\r?\n/);
    // "Week 3: 92.5%" / "Day 15 - 88" / "Period 3, 92.5"
    const labelled = /(week|day|period)\s*[:#]?\s*(\d+)\D{1,15}?(\d{1,3}(?:\.\d+)?)\s*%?/i;
    // Bare "3   92.5%" / "3, 92.5" — two numbers on a line, second is the %
    const bareTwoNumbers = /^\s*(\d+)\D{1,10}?(\d{1,3}(?:\.\d+)?)\s*%?\s*$/;

    for (const line of lines) {
      if (!line.trim()) continue;
      const m = labelled.exec(line) ?? bareTwoNumbers.exec(line);
      if (!m) continue;
      const periodIndex = parseInt(m[2] ?? m[1], 10);
      const percentStr  = m[3] ?? m[2];
      const targetHdpPercent = parseFloat(percentStr);
      if (Number.isFinite(periodIndex) && Number.isFinite(targetHdpPercent) &&
          periodIndex > 0 && targetHdpPercent >= 0 && targetHdpPercent <= 100) {
        points.push({ periodIndex, targetHdpPercent });
      }
    }
    return points;
  }

  private toRawNumber(cell: any): number | null {
    if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
    if (typeof cell === 'string') {
      const cleaned = cell.replace('%', '').trim();
      const n = Number(cleaned);
      return Number.isFinite(n) && cleaned !== '' ? n : null;
    }
    return null;
  }

  private toPeriodNumber(cell: any): number | null {
    const n = this.toRawNumber(cell);
    return n !== null ? Math.round(n) : null;
  }

  private toPercentNumber(cell: any): number | null {
    return this.toRawNumber(cell);
  }
}
