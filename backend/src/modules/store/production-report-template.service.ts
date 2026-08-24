// src/modules/store/production-report-template.service.ts
//
// "Improvement mechanism" for Store Production Reports: before the NEXT
// batch's report is uploaded (typically a fresh batch just placed in the
// brooder), generate a recommended spreadsheet TEMPLATE for the farm to
// fill in, built from what actually went wrong on the previous report:
//
//   • a blended "Drugs/Vaccine/Supplement" column         -> split into one
//     column per item actually used, named exactly as the store item, so
//     the auto-detector maps it with zero ambiguity next time.
//   • report text that couldn't be matched to any store    -> called out by
//     item last time (see production-report-reconciliation    name, so the
//     .service.ts's "Could not match" discrepancies)          farm knows to
//                                                              use that exact
//                                                              wording (or it's
//                                                              already fixed
//                                                              via a saved
//                                                              alias).
//   • cells that packed more than one item into one box      -> counted, so
//     (comma/slash-separated — see splitMultiValueCell)        the farm sees
//                                                               why one-item-
//                                                               per-column
//                                                               helps.
//
// This never rewrites or blocks anything about the CURRENT upload flow —
// it's a separate, purely advisory artifact Store can download before
// filling in next batch's paper/Excel sheet. If no previous report exists
// yet to learn from, it falls back to a sensible generic starting template.
import { Injectable, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { splitMultiValueCell } from './production-report-parser.service';
import {
  CanonicalField, CANONICAL_FIELD_LABELS, ProductionReportColumnMapping, ParsedReportRow,
} from './production-report.dto';
import { ProductionReportDiscrepancyType } from '@prisma/client';

export interface TemplateAnalysis {
  learnedFromBatchCode: string | null;
  recommendations: string[];
  columns: string[]; // final header row, in order, for the generated sheet
}

/** Canonical fields worth offering on a fresh template even if the source
 *  report never used them (date/notes always; the rest only carried over
 *  when the source report actually had them mapped — see buildAnalysis). */
const DEFAULT_FIELD_ORDER: CanonicalField[] = [
  'date', 'row', 'level', 'cage', 'feedKg', 'feedType', 'waterLts', 'mortality', 'culling',
  'openingStock', 'closingStock', 'avgWeight', 'temperature', 'humidity', 'lux', 'notes',
];

// Fields replaced by one-column-per-item below — never carried onto the
// generated template as a free-text/blended column, since that blended
// shape is exactly what causes the mismatches this feature exists to avoid.
const HEALTH_TEXT_FIELDS: CanonicalField[] = ['drugsVaccines', 'vaccineText', 'supplementText', 'treatmentText'];

@Injectable()
export class ProductionReportTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /** The most relevant prior report to learn from: the latest report from
   *  another batch in the SAME house (the house's own history is the most
   *  representative of how that house's sheets actually get filled in),
   *  falling back to the latest report anywhere in the system if this is
   *  the house's first-ever batch with a report. Never the target batch's
   *  own report (a batch about to get its first upload has none anyway,
   *  and a batch re-uploading should still learn from someone ELSE's past
   *  mistakes, not its own current one). */
  private async findSourceReport(targetBatchId: string, houseId: string) {
    const sameHouse = await this.prisma.storeProductionReport.findFirst({
      where: { batch: { houseId, id: { not: targetBatchId } } },
      orderBy: { uploadedAt: 'desc' },
      include: { batch: { select: { batchCode: true } } },
    });
    if (sameHouse) return sameHouse;

    return this.prisma.storeProductionReport.findFirst({
      where: { batchId: { not: targetBatchId } },
      orderBy: { uploadedAt: 'desc' },
      include: { batch: { select: { batchCode: true } } },
    });
  }

  async buildAnalysis(targetBatchId: string): Promise<TemplateAnalysis> {
    const target = await this.prisma.batch.findUnique({
      where: { id: targetBatchId },
      select: { id: true, houseId: true, batchCode: true },
    });
    if (!target) throw new NotFoundException('Batch not found');

    const source = await this.findSourceReport(target.id, target.houseId);
    const recommendations: string[] = [];

    if (!source) {
      return {
        learnedFromBatchCode: null,
        recommendations: [
          'No earlier production report was found to learn from yet, so this is a generic starting template — ' +
          'one column per common field, and one column per drug/vaccine/supplement should be added as they come ' +
          'into use. Once this batch\'s report is uploaded, future templates will be tailored from it.',
        ],
        columns: [...DEFAULT_FIELD_ORDER.map(f => CANONICAL_FIELD_LABELS[f])],
      };
    }

    const mapping = (source.columnMapping ?? {}) as unknown as ProductionReportColumnMapping;
    const usedFields = new Set(
      (Object.keys(mapping.fields ?? {}) as CanonicalField[]).filter(f => mapping.fields[f]),
    );
    const fieldKeys = DEFAULT_FIELD_ORDER.filter(
      f => f === 'date' || f === 'notes' || usedFields.has(f),
    );
    const columns = fieldKeys.map(f => CANONICAL_FIELD_LABELS[f]);

    const rows = ((source.rawRows ?? []) as unknown as ParsedReportRow[]);

    // One column per store item actually matched as a vaccine/supplement/
    // treatment, or issued as a generic item, on the source report — named
    // exactly as the store item so next report's auto-detector maps it with
    // no ambiguity at all (an exact-name match always wins over a fuzzy one).
    const itemColumns = new Map<string, { header: string; name: string; kind: string }>();
    for (const r of rows) {
      for (const u of r.healthUsages ?? []) {
        if (!u.storeItemId || !u.storeItemName || itemColumns.has(u.storeItemId)) continue;
        const kindLabel = u.kind.charAt(0).toUpperCase() + u.kind.slice(1);
        itemColumns.set(u.storeItemId, { header: `${u.storeItemName} (${kindLabel})`, name: u.storeItemName, kind: u.kind });
      }
      for (const it of r.itemsIssued ?? []) {
        if (!it.storeItemId || itemColumns.has(it.storeItemId)) continue;
        itemColumns.set(it.storeItemId, { header: it.storeItemName, name: it.storeItemName, kind: 'item' });
      }
    }
    columns.push(...[...itemColumns.values()].map(c => c.header));

    // ── Recommendations, explaining what changed and why ──────────────────
    const usedBlended = HEALTH_TEXT_FIELDS.some(f => mapping.fields[f]) && mapping.fields.drugsVaccines;
    if (usedBlended) {
      recommendations.push(
        `Batch ${source.batch.batchCode}'s sheet packed drugs, vaccines and supplements into one ` +
        `"${mapping.fields.drugsVaccines}" column — this template gives each item its own column instead, ` +
        `so entries never need decoding.`,
      );
    }

    const unmatchedDiscrepancies = await this.prisma.productionReportDiscrepancy.findMany({
      where: { reportId: source.id, notes: { contains: 'Could not match' } },
      select: { reportValue: true },
    });
    const unmatchedTexts = [...new Set(unmatchedDiscrepancies.map(d => d.reportValue).filter((v): v is string => !!v))].slice(0, 8);
    if (unmatchedTexts.length) {
      recommendations.push(
        `These entries couldn't be matched to a store item automatically last time: ` +
        `${unmatchedTexts.map(t => `"${t}"`).join(', ')}. Use the exact store item name on the sheet from now ` +
        `on (or match it once in the app — that wording is then remembered automatically).`,
      );
    }

    let multiValueCells = 0;
    for (const r of rows) {
      for (const text of [r.drugsVaccines, r.vaccineText, r.supplementText, r.treatmentText]) {
        if (text && splitMultiValueCell(text).length > 1) multiValueCells++;
      }
    }
    if (multiValueCells > 0) {
      recommendations.push(
        `${multiValueCells} cell${multiValueCells === 1 ? '' : 's'} in that report packed more than one item into ` +
        `a single box (comma/slash-separated) — the system now reads those correctly, but one column per item ` +
        `below means each box only ever needs a single number, which is far less error-prone to fill in.`,
      );
    }

    if (itemColumns.size) {
      recommendations.push(
        `Added one column per item actually used on batch ${source.batch.batchCode} ` +
        `(${[...itemColumns.values()].map(c => c.name).join(', ')}) — enter the quantity used that day, and ` +
        `leave the cell blank on days it wasn't used.`,
      );
    }

    // ── Recurring stock-count mismatches ───────────────────────────────────
    // Same root-cause logic as computeStockVarianceStreak() in
    // ProductionReportReconciliationService, but looking across the WHOLE
    // source batch rather than day-to-day within one — this is what turns a
    // pattern that recurred on the previous batch into a concrete column
    // change on the NEXT one, instead of it just quietly recurring again.
    const stockDiscrepancies = await this.prisma.productionReportDiscrepancy.findMany({
      where: { reportId: source.id, discrepancyType: ProductionReportDiscrepancyType.STOCK_COUNT },
      select: { field: true, notes: true },
    });
    const openingMismatches = stockDiscrepancies.filter(d => d.field === 'openingStock').length;
    const arithmeticMismatches = stockDiscrepancies.filter(d => d.field === 'closingStock').length;

    if (openingMismatches > 0) {
      recommendations.push(
        `Batch ${source.batch.batchCode}'s opening stock disagreed with the previous day's closing count on ` +
        `${openingMismatches} day${openingMismatches === 1 ? '' : 's'}. If a physical recount is ever done mid-batch, ` +
        `note the reason in Remarks that day — that turns an unexplained drift into a documented one instead of a ` +
        `repeat mismatch every time.`,
      );
    }
    // A same-day "opening minus mortality/culling ≠ closing" mismatch is
    // extremely often just a missing/blended Culling column — the system
    // only knows to subtract culling if the sheet had a distinct column for
    // it. If the source report never mapped one AND had arithmetic
    // mismatches, Culling gets forced onto the template even if it wasn't
    // in the DEFAULT_FIELD_ORDER carry-over above, since that's the
    // concrete fix rather than just a note to "be more careful".
    if (arithmeticMismatches > 0) {
      const cullingLabel = CANONICAL_FIELD_LABELS.culling;
      if (!columns.includes(cullingLabel)) {
        columns.splice(columns.indexOf(CANONICAL_FIELD_LABELS.mortality) + 1 || columns.length, 0, cullingLabel);
      }
      recommendations.push(
        `Batch ${source.batch.batchCode}'s own opening/closing stock figures didn't add up against its recorded ` +
        `mortality on ${arithmeticMismatches} day${arithmeticMismatches === 1 ? '' : 's'} — most often because culled ` +
        `birds were removed from the count but not written down anywhere separate from mortality. A dedicated ` +
        `${cullingLabel.toLowerCase()} column is included below; if it's zero most days, leave it blank rather than ` +
        `folding it into mortality.`,
      );
    }

    if (!recommendations.length) {
      recommendations.push(
        `Batch ${source.batch.batchCode}'s report had no recurring formatting issues — this template mirrors ` +
        `the same columns that already worked well.`,
      );
    }

    return { learnedFromBatchCode: source.batch.batchCode, recommendations, columns };
  }

  async generateWorkbook(targetBatchId: string): Promise<{ buffer: Buffer; fileName: string; analysis: TemplateAnalysis }> {
    const target = await this.prisma.batch.findUnique({ where: { id: targetBatchId }, select: { batchCode: true } });
    if (!target) throw new NotFoundException('Batch not found');
    const analysis = await this.buildAnalysis(targetBatchId);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([analysis.columns]);
    // A sensible default column width so the sheet is immediately usable
    // rather than every column collapsed to its header's character width.
    (ws as any)['!cols'] = analysis.columns.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Daily Record');

    const instructionsRows: (string | undefined)[][] = [
      ['Recommended template'],
      ['Learned from batch', analysis.learnedFromBatchCode ?? '(no earlier report yet — generic starting template)'],
      [],
      ['Why these columns:'],
      ...analysis.recommendations.map(r => [r]),
      [],
      ['One item per column. Enter just the quantity used that day. Leave a cell blank on a day nothing was used.'],
      ['Never combine two items in a single cell — if a new item needs its own column, add it to this sheet before use.'],
    ];
    const notesWs = XLSX.utils.aoa_to_sheet(instructionsRows);
    (notesWs as any)['!cols'] = [{ wch: 100 }];
    XLSX.utils.book_append_sheet(wb, notesWs, 'Instructions');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return { buffer, fileName: `${target.batchCode}-report-template.xlsx`, analysis };
  }
}
