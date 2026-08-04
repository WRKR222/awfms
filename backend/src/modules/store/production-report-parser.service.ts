// src/modules/store/production-report-parser.service.ts
// Generic spreadsheet -> canonical row parser for Store Production Reports.
// Deliberately format-agnostic: any header layout can be handled as long as
// the columns get mapped (auto-suggested, always overridable) to the
// canonical fields in production-report.dto.ts, or to a known StoreItem for
// "items issued" columns (e.g. a "Charcoal" column).
import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CanonicalField, FIELD_SYNONYMS, ProductionReportColumnMapping, ParsedReportRow, ParsedItemUsage,
} from './production-report.dto';

function normaliseHeader(h: string): string {
  return String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Pulls the leading numeric quantity + trailing unit text out of a cell like
 *  "6bags", "2 bags", "39.2mls" — the format the farm's paper sheets use for
 *  "amount of X used today". Returns null if no number is present. */
function extractQuantity(raw: any): { qty: number; unit?: string } | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)/);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  if (!Number.isFinite(qty)) return null;
  return { qty, unit: m[2] || undefined };
}

@Injectable()
export class ProductionReportParserService {
  constructor(private readonly prisma: PrismaService) {}

  /** Parse just the header row + a few preview rows, and suggest a column
   *  mapping (canonical fields via synonym match, item columns via fuzzy
   *  match against active StoreItem names). Used by the upload wizard
   *  before anything is committed. */
  async detectHeaders(buffer: Buffer) {
    const { headers, rows } = this.readSheet(buffer);
    if (!headers.length) return { headers: [], previewRows: [], suggestedMapping: { fields: {}, items: {} }, totalRows: 0 };

    const storeItems = await this.prisma.storeItem.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    const suggestedMapping = this.suggestMapping(headers, storeItems);
    const previewRows = rows.slice(0, 8);

    return { headers, previewRows, suggestedMapping, totalRows: rows.length };
  }

  /** Parse every row into canonical ParsedReportRow shape using a confirmed
   *  mapping. No cross-checking happens here — that's the reconciliation
   *  service's job — this is pure "read the sheet" logic. */
  parseRows(buffer: Buffer, mapping: ProductionReportColumnMapping): ParsedReportRow[] {
    const { rows } = this.readSheet(buffer);
    const out: ParsedReportRow[] = [];

    const itemEntries = Object.entries(mapping.items ?? {});

    for (const row of rows) {
      const dateCol = mapping.fields.date;
      if (!dateCol) throw new BadRequestException('Date column must be mapped');
      const rawDate = row[dateCol];
      const date = this.coerceDate(rawDate);
      if (!date) continue; // skip separator/blank rows — this format has occasional empty rows between weeks

      const locParts: string[] = [];
      for (const f of ['row', 'level', 'cage'] as CanonicalField[]) {
        const col = mapping.fields[f];
        if (col && row[col] !== '' && row[col] != null) locParts.push(`${f[0].toUpperCase()}${f.slice(1)} ${row[col]}`);
      }

      const numOrUndef = (v: any): number | undefined => {
        if (v === '' || v == null) return undefined;
        const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
        return Number.isFinite(n) ? n : undefined;
      };
      const strOrUndef = (v: any): string | undefined => (v === '' || v == null ? undefined : String(v));

      const itemsIssued: ParsedItemUsage[] = [];
      for (const [storeItemId, col] of itemEntries) {
        const cell = row[col];
        const parsed = extractQuantity(cell);
        if (!parsed) continue;
        itemsIssued.push({
          storeItemId,
          storeItemName: '', // filled in by the reconciliation service, which has the StoreItem loaded
          quantity: parsed.qty,
          unit: parsed.unit,
          rawText: String(cell),
          resolution: 'MATCHED', // placeholder — overwritten during reconciliation
        });
      }

      out.push({
        date,
        locationRef: locParts.length ? locParts.join(' / ') : null,
        feedKg:        numOrUndef(mapping.fields.feedKg        && row[mapping.fields.feedKg]),
        feedType:      strOrUndef(mapping.fields.feedType      && row[mapping.fields.feedType]),
        waterLts:      numOrUndef(mapping.fields.waterLts      && row[mapping.fields.waterLts]),
        mortality:     numOrUndef(mapping.fields.mortality     && row[mapping.fields.mortality]),
        culling:       numOrUndef(mapping.fields.culling       && row[mapping.fields.culling]),
        openingStock:  numOrUndef(mapping.fields.openingStock  && row[mapping.fields.openingStock]),
        closingStock:  numOrUndef(mapping.fields.closingStock  && row[mapping.fields.closingStock]),
        avgWeight:     strOrUndef(mapping.fields.avgWeight     && row[mapping.fields.avgWeight]),
        temperature:   strOrUndef(mapping.fields.temperature   && row[mapping.fields.temperature]),
        humidity:      strOrUndef(mapping.fields.humidity      && row[mapping.fields.humidity]),
        lux:           strOrUndef(mapping.fields.lux           && row[mapping.fields.lux]),
        drugsVaccines: strOrUndef(mapping.fields.drugsVaccines && row[mapping.fields.drugsVaccines]),
        notes:         strOrUndef(mapping.fields.notes         && row[mapping.fields.notes]),
        itemsIssued,
        raw: row,
        resolution: {},
      });
    }

    return out;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private readSheet(buffer: Buffer): { headers: string[]; rows: Record<string, any>[] } {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, sheetStubs: true });
    } catch {
      throw new BadRequestException('Could not parse file. Ensure it is a valid .xlsx, .xls, or .csv.');
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];

    // The farm's sheets carry a few free-text banner rows (farm name, month,
    // supplier, year) above the real header row — find the row that actually
    // looks like a header (matches at least 2 known synonyms) instead of
    // assuming row 0.
    let headerRowIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < Math.min(raw.length, 15); i++) {
      const score = (raw[i] as any[]).filter(cell => this.matchSynonym(String(cell ?? ''))).length;
      if (score > bestScore) { bestScore = score; headerRowIdx = i; }
    }
    if (bestScore < 2) headerRowIdx = 0; // fall back to first row if nothing looks like a header

    const headers = (raw[headerRowIdx] as any[]).map(h => String(h ?? '').trim()).filter(h => h !== '');
    const headerRowFull = (raw[headerRowIdx] as any[]).map(h => String(h ?? '').trim());
    const rows = raw.slice(headerRowIdx + 1).map(r =>
      Object.fromEntries(headerRowFull.map((h, i) => [h, (r as any[])[i] ?? '']).filter(([h]) => h !== '')),
    );
    return { headers, rows };
  }

  private matchSynonym(header: string): CanonicalField | null {
    const norm = normaliseHeader(header);
    if (!norm) return null;
    for (const [field, syns] of Object.entries(FIELD_SYNONYMS) as [CanonicalField, string[]][]) {
      if (syns.some(s => norm === s || norm.includes(s))) return field;
    }
    return null;
  }

  private suggestMapping(
    headers: string[],
    storeItems: { id: string; name: string }[],
  ): ProductionReportColumnMapping {
    const fields: Partial<Record<CanonicalField, string>> = {};
    const items: Record<string, string> = {};
    const usedHeaders = new Set<string>();

    for (const h of headers) {
      const field = this.matchSynonym(h);
      if (field && !fields[field]) {
        fields[field] = h;
        usedHeaders.add(h);
      }
    }

    // Remaining unmatched headers — try to fuzzy-match against store item
    // names (e.g. a "Charcoal" column against a StoreItem named "Charcoal").
    for (const h of headers) {
      if (usedHeaders.has(h)) continue;
      const normH = normaliseHeader(h);
      if (!normH) continue;
      const match = storeItems.find(si => {
        const normName = normaliseHeader(si.name);
        return normName === normH || normH.includes(normName) || normName.includes(normH);
      });
      if (match) items[match.id] = h;
    }

    return { fields, items };
  }

  private coerceDate(raw: any): string | null {
    if (!raw) return null;
    if (raw instanceof Date && !isNaN(raw.getTime())) {
      return raw.toISOString().slice(0, 10);
    }
    // Excel serial date fallback (when cellDates didn't apply, e.g. some CSV paths)
    if (typeof raw === 'number' && raw > 0) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const parsed = new Date(epoch.getTime() + raw * 86400000);
      if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }
    const parsed = new Date(String(raw));
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return null;
  }
}
