// src/components/production-report/ReportTable.tsx
// Renders a ParsedReportRow[] (the exact shape stored in
// StoreProductionReport.rawRows, and what the parser's preview() returns
// before submission) as a day-by-day table — the "looks like the Excel
// sheet" view used both by Store (reviewing a fresh upload before
// submitting) and by the Director (pulling a batch's current stored
// report). Kept in one place so both stay visually/behaviourally identical.
import dayjs from '../../lib/dayjs';

export interface PresentItemColumn { storeItemId: string; storeItemName: string; header?: string; }

// Every canonical field the parser understands, in display order — mirrors
// CANONICAL_FIELD_LABELS in the backend DTO.
const TABLE_COLUMNS: { key: string; label: string; render?: (row: any) => string }[] = [
  { key: 'date', label: 'Date', render: r => dayjs(r.date).format('D MMM') },
  { key: 'locationRef', label: 'Row/Level/Cage', render: r => r.locationRef ?? '—' },
  { key: 'feedKg', label: 'Feed (Kg)' },
  { key: 'feedType', label: 'Feed Type' },
  { key: 'waterLts', label: 'Water (L)' },
  { key: 'mortality', label: 'Mortality' },
  { key: 'culling', label: 'Culling' },
  { key: 'openingStock', label: 'Opening' },
  { key: 'closingStock', label: 'Closing' },
  { key: 'avgWeight', label: 'Avg Weight' },
  { key: 'temperature', label: 'Temp', render: r => r.temperatureReadings?.length ? r.temperatureReadings.map((x: any) => x.value).join(' / ') : (r.temperature ?? '—') },
  { key: 'humidity', label: 'Humidity', render: r => r.humidityReadings?.length ? r.humidityReadings.map((x: any) => x.value).join(' / ') : (r.humidity ?? '—') },
  { key: 'lux', label: 'Lux', render: r => r.luxReadings?.length ? r.luxReadings.map((x: any) => x.value).join(' / ') : (r.lux ?? '—') },
  { key: 'vaccineText', label: 'Vaccine' },
  { key: 'supplementText', label: 'Supplement' },
  { key: 'treatmentText', label: 'Treatment' },
  { key: 'drugsVaccines', label: 'Drugs/Vaccines' },
  { key: 'notes', label: 'Remarks' },
];

const READING_ARRAY_KEYS: Record<string, string> = { temperature: 'temperatureReadings', humidity: 'humidityReadings', lux: 'luxReadings' };

/** Same "only columns with data" rule preview() uses server-side (§2), but
 *  computed client-side from rawRows so pulling a stored report doesn't
 *  need a second endpoint just to know which columns to show. */
export function computePresentColumns(rows: any[]): { presentFields: string[]; presentItemColumns: PresentItemColumn[] } {
  const presentFields = TABLE_COLUMNS
    .map(c => c.key)
    .filter(key => rows.some(r => {
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

export function ProductionReportTable({ rows, presentFields, presentItemColumns }: {
  rows: any[]; presentFields: string[]; presentItemColumns: PresentItemColumn[];
}) {
  const cols = TABLE_COLUMNS.filter(c => presentFields.includes(c.key) || c.key === 'date');
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-8">No rows in this report.</p>;
  }
  return (
    <div className="border border-gray-200 dark:border-dark-border rounded-xl overflow-auto max-h-[420px]">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 dark:bg-dark-bg sticky top-0">
          <tr>
            {cols.map(c => (
              <th key={c.key} className="px-2.5 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">{c.label}</th>
            ))}
            {presentItemColumns.map(ic => (
              <th key={ic.storeItemId} className="px-2.5 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">{ic.header ?? ic.storeItemName}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-dark-border">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50 dark:hover:bg-dark-bg/60">
              {cols.map(c => (
                <td key={c.key} className="px-2.5 py-1.5 whitespace-nowrap text-gray-700 dark:text-gray-300">
                  {c.render ? c.render(r) : (r[c.key] ?? '—')}
                </td>
              ))}
              {presentItemColumns.map(ic => {
                const usage = r.itemsIssued?.find((u: any) => u.storeItemId === ic.storeItemId);
                return (
                  <td key={ic.storeItemId} className="px-2.5 py-1.5 whitespace-nowrap text-gray-700 dark:text-gray-300">
                    {usage ? `${usage.quantity}${usage.unit ?? ''}` : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
