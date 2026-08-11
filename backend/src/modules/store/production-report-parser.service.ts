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
  MULTI_READING_FIELDS, MultiReadingField, MAX_ENV_READINGS_PER_DAY, ENV_READING_LABELS, EnvReading,
  FeedSplitPortion,
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

/** Splits a single cell that packs multiple same-day readings into one
 *  string — e.g. "32,31,30" (Temp) or "100,70" (Lux) — into its individual
 *  values. This is the common paper-sheet shorthand: one "Temp"/"Lux"/
 *  "Humidity" column per day, with morning/midday/evening readings jammed
 *  into the same cell separated by commas (occasionally semicolons or
 *  slashes), rather than three separate columns. Blank tokens are dropped;
 *  callers cap the result at MAX_ENV_READINGS_PER_DAY and drop any beyond
 *  that (§ "ignore the extra values" — some rows carry more than 3 raw
 *  readings; only the first 3, in order, are ever recorded). */
export function splitMultiValueCell(raw: any): string[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  return text.split(/[,;/]+/).map(s => s.trim()).filter(s => s !== '');
}

/** Matches a two-way "<labelA>/<labelB> <pctA>[:/-]<pctB>[%]" split cell,
 *  e.g. "chickcrumbs/growers 75:25%", "Chick Crumbs / Growers 75-25",
 *  "crumbs/grower 75%:25%". Only ever a HINT that the cell is a split —
 *  callers still fall back to the plain single-feedType path whenever this
 *  returns null (no ratio found, more/fewer than 2 labels, or a
 *  non-positive percentage), so an ordinary "Chick Mash" or "Growers Mash"
 *  cell is completely unaffected. */
const FEED_SPLIT_RATIO_RE = /^(.*?)\s+(\d+(?:\.\d+)?)\s*%?\s*[:\-/]\s*(\d+(?:\.\d+)?)\s*%?\s*$/;

/** Parses a "Feed Type" cell for a two-way percentage split and returns each
 *  portion's normalised percent (always summing to exactly 100) — kg is
 *  filled in by the caller once feedKg for the row is known. Returns null
 *  when the cell isn't a recognisable split (the normal, single-feed-type
 *  case). */
export function parseFeedSplitRatio(feedTypeText: string | undefined): { label: string; percent: number }[] | null {
  const text = String(feedTypeText ?? '').trim();
  if (!text) return null;
  const m = FEED_SPLIT_RATIO_RE.exec(text);
  if (!m) return null;
  const pctA = parseFloat(m[2]);
  const pctB = parseFloat(m[3]);
  if (!Number.isFinite(pctA) || !Number.isFinite(pctB) || pctA <= 0 || pctB <= 0) return null;
  const labels = m[1].split('/').map(s => s.trim()).filter(Boolean);
  if (labels.length !== 2) return null; // only two-way splits are currently supported
  const sum = pctA + pctB;
  return [
    { label: labels[0], percent: (pctA / sum) * 100 },
    { label: labels[1], percent: (pctB / sum) * 100 },
  ];
}

/** Builds the full FeedSplitPortion[] (percent + this row's kg share) for a
 *  row, or undefined if the cell isn't a split or feedKg isn't known yet.
 *  Portions' kg always sum to exactly feedKgTotal (rounding is applied only
 *  to the first portion's complement so nothing is lost to rounding). */
export function buildFeedSplit(feedTypeText: string | undefined, feedKgTotal: number | undefined): FeedSplitPortion[] | undefined {
  if (feedKgTotal === undefined) return undefined;
  const ratio = parseFeedSplitRatio(feedTypeText);
  if (!ratio) return undefined;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const firstKg = round2(feedKgTotal * ratio[0].percent / 100);
  const secondKg = round2(feedKgTotal - firstKg); // remainder, so the two always add up exactly
  return [
    { label: ratio[0].label, percent: round2(ratio[0].percent), kg: firstKg },
    { label: ratio[1].label, percent: round2(ratio[1].percent), kg: secondKg },
  ];
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
    if (!headers.length) return { headers: [], previewRows: [], suggestedMapping: { fields: {}, items: {}, envFields: {} }, totalRows: 0 };

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
      let rowNumber: number | undefined;
      let levelNumber: number | undefined;
      let cageNumber: number | undefined;
      for (const f of ['row', 'level', 'cage'] as CanonicalField[]) {
        const col = mapping.fields[f];
        if (col && row[col] !== '' && row[col] != null) {
          locParts.push(`${f[0].toUpperCase()}${f.slice(1)} ${row[col]}`);
          const m = String(row[col]).match(/\d+/);
          const n = m ? parseInt(m[0], 10) : undefined;
          if (f === 'row') rowNumber = n;
          else if (f === 'level') levelNumber = n;
          else if (f === 'cage') cageNumber = n;
        }
      }

      const numOrUndef = (v: any): number | undefined => {
        if (v === '' || v == null) return undefined;
        const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
        return Number.isFinite(n) ? n : undefined;
      };
      // Trims before checking for emptiness — a cell containing only
      // whitespace (a stray space left over from copy/paste, a formula that
      // resolves to " ", etc.) must be treated as blank, not as "text
      // present". Without the trim, a whitespace-only vaccine/supplement/
      // treatment cell survives as a truthy, non-empty string, gets fed into
      // the item matcher in the reconciliation service, fails to match
      // anything (there's no store item named " "), and raises a
      // "doesn't match any store item by name" discrepancy every single day
      // the sheet has that stray space — with nothing visible for Store to
      // even look at, since the "raw text" it's complaining about is blank.
      const strOrUndef = (v: any): string | undefined => {
        if (v === '' || v == null) return undefined;
        const s = String(v).trim();
        return s === '' ? undefined : s;
      };

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

      // ── Environmental readings (temp/humidity/lux), 1-3×/day ────────────
      // §11: if the sheet carries multiple same-day columns per metric, only
      // the first MAX_ENV_READINGS_PER_DAY (in sheet column order, which is
      // how envFields was built during suggestMapping/override) are read;
      // if the sheet has just 1-2, record only that many. Just as commonly,
      // a sheet has ONE column per metric but packs all of a day's readings
      // into that one cell ("32,31,30") — that's handled by splitting the
      // cell itself when there's no multi-column mapping for the metric.
      const readEnvReadings = (field: MultiReadingField): EnvReading[] | undefined => {
        const cols = mapping.envFields?.[field];
        if (cols && cols.length > 0) {
          const readings: EnvReading[] = [];
          for (let i = 0; i < Math.min(cols.length, MAX_ENV_READINGS_PER_DAY); i++) {
            const cell = row[cols[i]];
            if (cell === '' || cell == null) continue;
            readings.push({ label: ENV_READING_LABELS[i], value: String(cell) });
          }
          return readings.length ? readings : undefined;
        }
        // Single-column case — split the cell itself if it packs more than
        // one value. A cell with exactly one value falls through to the
        // plain single-value field below (unchanged, backward-compatible).
        const singleCol = mapping.fields[field];
        if (!singleCol) return undefined;
        const tokens = splitMultiValueCell(row[singleCol]).slice(0, MAX_ENV_READINGS_PER_DAY);
        if (tokens.length <= 1) return undefined;
        return tokens.map((value, i) => ({ label: ENV_READING_LABELS[i], value }));
      };
      const temperatureReadings = readEnvReadings('temperature');
      const humidityReadings = readEnvReadings('humidity');
      const luxReadings = readEnvReadings('lux');

      const feedKgVal = numOrUndef(mapping.fields.feedKg && row[mapping.fields.feedKg]);
      const feedTypeVal = strOrUndef(mapping.fields.feedType && row[mapping.fields.feedType]);

      out.push({
        date,
        locationRef: locParts.length ? locParts.join(' / ') : null,
        rowNumber, levelNumber, cageNumber,
        feedKg:        feedKgVal,
        feedType:      feedTypeVal,
        // e.g. "chickcrumbs/growers 75:25%" -> 75% Chick Crumbs, 25% Growers,
        // each kg computed from feedKgVal. undefined for ordinary single-type cells.
        feedSplit:     buildFeedSplit(feedTypeVal, feedKgVal),
        waterLts:      numOrUndef(mapping.fields.waterLts      && row[mapping.fields.waterLts]),
        mortality:     numOrUndef(mapping.fields.mortality     && row[mapping.fields.mortality]),
        culling:       numOrUndef(mapping.fields.culling       && row[mapping.fields.culling]),
        openingStock:  numOrUndef(mapping.fields.openingStock  && row[mapping.fields.openingStock]),
        closingStock:  numOrUndef(mapping.fields.closingStock  && row[mapping.fields.closingStock]),
        avgWeight:     strOrUndef(mapping.fields.avgWeight     && row[mapping.fields.avgWeight]),
        // Single-column fallback only used when there's no multi-reading
        // mapping for that metric — otherwise the *Readings arrays are the
        // source of truth and this stays undefined to avoid double-counting.
        temperature:   temperatureReadings ? undefined : strOrUndef(mapping.fields.temperature && row[mapping.fields.temperature]),
        humidity:      humidityReadings    ? undefined : strOrUndef(mapping.fields.humidity    && row[mapping.fields.humidity]),
        lux:           luxReadings         ? undefined : strOrUndef(mapping.fields.lux          && row[mapping.fields.lux]),
        temperatureReadings,
        humidityReadings,
        luxReadings,
        drugsVaccines:  strOrUndef(mapping.fields.drugsVaccines  && row[mapping.fields.drugsVaccines]),
        vaccineText:    strOrUndef(mapping.fields.vaccineText    && row[mapping.fields.vaccineText]),
        supplementText: strOrUndef(mapping.fields.supplementText && row[mapping.fields.supplementText]),
        treatmentText:  strOrUndef(mapping.fields.treatmentText  && row[mapping.fields.treatmentText]),
        notes:         strOrUndef(mapping.fields.notes         && row[mapping.fields.notes]),
        itemsIssued,
        healthUsages: [], // matched during reconciliation, same pattern as feed
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

    // Column layout can carry duplicate header labels (e.g. "Temp", "Temp",
    // "Temp" for AM/Noon/PM) — dedupe headers/rows must preserve each
    // occurrence with a distinct key so envFields can address them
    // individually, while still returning a display-friendly headers[] list.
    const headerRowFull = (raw[headerRowIdx] as any[]).map(h => String(h ?? '').trim());
    const seen = new Map<string, number>();
    const uniqueKeys = headerRowFull.map(h => {
      if (h === '') return '';
      const count = seen.get(h) ?? 0;
      seen.set(h, count + 1);
      return count === 0 ? h : `${h} (${count + 1})`;
    });

    const headers = uniqueKeys.filter(h => h !== '');
    const rows = raw.slice(headerRowIdx + 1).map(r =>
      Object.fromEntries(uniqueKeys.map((h, i) => [h, (r as any[])[i] ?? '']).filter(([h]) => h !== '')),
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
    const envFields: Partial<Record<MultiReadingField, string[]>> = {};
    const usedHeaders = new Set<string>();

    // First pass: collect every header matching a multi-reading field
    // (temperature/humidity/lux), in sheet column order — a sheet with
    // "Temp AM" / "Temp Noon" / "Temp PM" produces 3 entries here.
    for (const h of headers) {
      const field = this.matchSynonym(h);
      if (field && (MULTI_READING_FIELDS as readonly string[]).includes(field)) {
        const mf = field as MultiReadingField;
        (envFields[mf] ??= []).push(h);
        usedHeaders.add(h);
      }
    }
    // If a metric matched exactly once, it's just a normal single column —
    // let it flow through `fields` instead of `envFields` (keeps simple
    // sheets on the plain, backward-compatible path).
    for (const mf of MULTI_READING_FIELDS) {
      const cols = envFields[mf];
      if (cols && cols.length === 1) {
        fields[mf] = cols[0];
        delete envFields[mf];
      }
    }

    for (const h of headers) {
      if (usedHeaders.has(h)) continue;
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

    return { fields, items, envFields };
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
