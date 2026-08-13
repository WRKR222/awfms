// src/components/production-report/ReportTable.tsx
// Renders a ParsedReportRow[] (the exact shape stored in
// StoreProductionReport.rawRows, and what the parser's preview() returns
// before submission) as a day-by-day table — the "looks like the Excel
// sheet" view used both by Store (reviewing a fresh upload before
// submitting, and pulling up what's currently on file) and by the Director
// (pulling a batch's current stored report). Kept in one place so both
// stay visually/behaviourally identical — same component, same data, same
// columns, for both roles.
//
// IMPORTANT: this renders the report AS UPLOADED. Every column the source
// spreadsheet had, and every cell in every row, is shown — including
// columns the system doesn't understand as a canonical field or a matched
// store item (e.g. "Cracked eggs", "%Yield", "Week", "Day" on a real farm
// sheet). Nothing is filtered out for being "not mapped" or "empty across
// every row". The parser already preserves the untouched header->cell map
// per row as `row.raw` (see production-report-parser.service.ts
// readSheet()/parseRows()) specifically so this view can be a faithful
// reproduction of the original file rather than just the subset the system
// knows how to reconcile.
import dayjs from '../../lib/dayjs';

export interface PresentItemColumn { storeItemId: string; storeItemName: string; header?: string; }

/** Kept only for backward compatibility with callers still importing this
 *  (e.g. anything computing which canonical fields the report touched for
 *  its own summary text) — no longer used to decide which columns render
 *  in the table itself. See header comment above: the table now always
 *  shows every original column. */
export function computePresentColumns(rows: any[]): { presentFields: string[]; presentItemColumns: PresentItemColumn[] } {
  const READING_ARRAY_KEYS: Record<string, string> = { temperature: 'temperatureReadings', humidity: 'humidityReadings', lux: 'luxReadings' };
  const CANONICAL_KEYS = [
    'date', 'locationRef', 'feedKg', 'feedType', 'waterLts', 'mortality', 'culling',
    'openingStock', 'closingStock', 'avgWeight', 'temperature', 'humidity', 'lux',
    'vaccineText', 'supplementText', 'treatmentText', 'drugsVaccines', 'notes',
  ];
  const presentFields = CANONICAL_KEYS.filter(key => rows.some(r => {
    const arrKey = READING_ARRAY_KEYS[key];
    if (arrKey && Array.isArray(r[arrKey]) && r[arrKey].length) return true;
    const v = r[key];
    return v !== undefined && v !== null && v !== '';
  }));

  const seen = new Map<string, PresentItemColumn>();
  for (const r of rows) {
    for (const usage of r.itemsIssued ?? []) {
      if (!seen.has(usage.storeItemId)) seen.set(usage.storeItemId, { storeItemId: usage.storeItemId, storeItemName: usage.storeItemName ?? '(unknown item)' });
    }
  }
  return { presentFields, presentItemColumns: [...seen.values()] };
}

/** Every header the ORIGINAL uploaded sheet carried, in original column
 *  order — derived from each row's `raw` (the untouched header->cell map
 *  the parser keeps per row). Rows normally all share the exact same key
 *  set, but this unions across every row (first-seen order) just in case,
 *  so a header is never dropped just because one particular row happened
 *  to omit it. */
function computeRawHeaders(rows: any[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    for (const h of Object.keys(r?.raw ?? {})) {
      if (!seen.has(h)) { seen.add(h); out.push(h); }
    }
  }
  return out;
}

function formatCell(v: any): string {
  if (v === undefined || v === null || v === '') return '—';
  if (v instanceof Date) return dayjs(v).format('D MMM YYYY');
  return String(v);
}

/** Small per-row status dot — purely additive context (does not hide or
 *  replace any column). Reflects the worst outcome among whatever fields
 *  on that row were cross-checked against the system: a discrepancy on
 *  ANY field beats an autofill, which beats a plain match. Rows the
 *  reconciler never touched (nothing to cross-check) show a neutral dot. */
function rowStatus(row: any): { color: string; label: string } {
  const vals = Object.values(row?.resolution ?? {}).filter(Boolean) as string[];
  if (vals.includes('DISCREPANCY')) return { color: 'bg-amber-400', label: 'Has a discrepancy — see the list below the table' };
  if (vals.includes('AUTOFILLED')) return { color: 'bg-blue-400', label: 'Auto-filled into the system (nothing was recorded yet)' };
  if (vals.includes('MATCHED')) return { color: 'bg-green-400', label: 'Matches what is already recorded' };
  return { color: 'bg-gray-300', label: 'Nothing on this row was cross-checked against system records' };
}

export function ProductionReportTable({ rows, headers: orderedHeaders }: {
  rows: any[];
  /** Original sheet column order (StoreProductionReport.rawHeaders). Pass
   *  this whenever it's available — rawRows is stored as jsonb, which does
   *  NOT preserve object key order once round-tripped through Postgres, so
   *  deriving column order from Object.keys(row.raw) alone (the
   *  computeRawHeaders() fallback below) can render columns in a different
   *  order than the uploaded sheet had them, particularly for the
   *  Director's view of an already-submitted report. Omit only for reports
   *  saved before this field existed (falls back to computeRawHeaders). */
  headers?: string[];
  /** @deprecated no longer used — every original column always renders */
  presentFields?: string[];
  /** @deprecated no longer used — every original column always renders */
  presentItemColumns?: PresentItemColumn[];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-8">No rows in this report.</p>;
  }
  // Prefer the persisted original order; fall back to reconstructing it
  // from the rows themselves only for older reports that predate
  // rawHeaders (or if it somehow came back empty).
  const headers = orderedHeaders && orderedHeaders.length ? orderedHeaders : computeRawHeaders(rows);

  return (
    <div className="border border-gray-200 dark:border-dark-border rounded-xl overflow-auto max-h-[420px]">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 dark:bg-dark-bg sticky top-0">
          <tr>
            <th className="px-2 py-2 text-left font-semibold text-gray-500 whitespace-nowrap w-6" title="Reconciliation status for this row">
              <span className="sr-only">Status</span>
            </th>
            {headers.map(h => (
              <th key={h} className="px-2.5 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-dark-border">
          {rows.map((r, i) => {
            const status = rowStatus(r);
            return (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-dark-bg/60">
                <td className="px-2 py-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${status.color}`} title={status.label} />
                </td>
                {headers.map(h => (
                  <td key={h} className="px-2.5 py-1.5 whitespace-nowrap text-gray-700 dark:text-gray-300">
                    {formatCell(r.raw?.[h])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
