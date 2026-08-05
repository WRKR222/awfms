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

      // ── Environmental readings (temp/humidity/lux), 1-3×/day ────────────
      // §11: if the sheet carries multiple same-day columns per metric, only
      // the first MAX_ENV_READINGS_PER_DAY (in sheet column order, which is
      // how envFields was built during suggestMapping/override) are read;
      // if the sheet has just 1-2, record only that many.
      const readEnvReadings = (field: MultiReadingField): EnvReading[] | undefined => {
        const cols = mapping.envFields?.[field];
        if (!cols || cols.length === 0) return undefined;
        const readings: EnvReading[] = [];
        for (let i = 0; i < Math.min(cols.length, MAX_ENV_READINGS_PER_DAY); i++) {
          const cell = row[cols[i]];
          if (cell === '' || cell == null) continue;
          readings.push({ label: ENV_READING_LABELS[i], value: String(cell) });
        }
        return readings.length ? readings : undefined;
      };
      const temperatureReadings = readEnvReadings('temperature');
      const humidityReadings = readEnvReadings('humidity');
      const luxReadings = readEnvReadings('lux');

      out.push({
        date,
        locationRef: locParts.length ? locParts.join(' / ') : null,
        rowNumber, levelNumber, cageNumber,
        feedKg:        numOrUndef(mapping.fields.feedKg        && row[mapping.fields.feedKg]),
        feedType:      strOrUndef(mapping.fields.feedType      && row[mapping.fields.feedType]),
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
