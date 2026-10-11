// src/components/shared/BreedRecordingPlan.tsx
//
// Batch registration: once the typed breed matches a breed guide (e.g.
// "Hyline Brown Max" → Hy-Line Brown, January 2024 edition), the farmer
// chooses which guide parameters they will record. Anything unticked is
// shown with what the farm gives up; parameters the farm cannot measure at
// all (egg grading, egg quality, body condition, water tests) are listed
// separately. Also captures housing / lighting and the nutrition programme.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../lib/api/client';

export interface BreedSetup {
  untrackedMetrics: string[];
  housingType: 'LIGHT_CONTROLLED' | 'OPEN_SIDED';
  housingDescription: string;
  declaredLightHours: string;
  nutritionProgram: 'BOTH' | 'ECONOMICAL' | 'OPTIMAL';
}

export const emptyBreedSetup: BreedSetup = {
  untrackedMetrics: [],
  housingType: 'LIGHT_CONTROLLED',
  housingDescription: '',
  declaredLightHours: '',
  nutritionProgram: 'BOTH',
};

/** Payload fields for POST /flock/batches or PATCH /breed-standards/batches/:id/setup. */
export function breedSetupPayload(s: BreedSetup) {
  return {
    untrackedMetrics: s.untrackedMetrics,
    housingType: s.housingType,
    housingDescription: s.housingDescription.trim() || null,
    declaredLightHours: s.declaredLightHours === '' ? null : Number(s.declaredLightHours),
    nutritionProgram: s.nutritionProgram,
  };
}

interface Options {
  breed: { id: string; name: string; variety: string | null } | null;
  guide: { title: string; versionLabel: string; versionYear: number } | null;
  recordable: { key: string; label: string; unit: string; capture: string; defaultOn: boolean; implication: string }[];
  notRecordable: { key: string; label: string; implication: string }[];
}

const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100';

export function BreedRecordingPlan({ strain, value, onChange }: {
  strain: string;
  value: BreedSetup;
  onChange: (v: BreedSetup) => void;
}) {
  const [query, setQuery] = useState(strain);
  const [showNoInput, setShowNoInput] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQuery(strain.trim()), 400);
    return () => clearTimeout(t);
  }, [strain]);

  const { data, isFetching } = useQuery<Options>({
    queryKey: ['breed-registration-options', query],
    queryFn: () => api.get('/breed-standards/registration-options', { params: { strain: query } }).then(r => r.data),
    enabled: query.length >= 3,
    staleTime: 60_000,
  });

  if (query.length < 3) return null;
  if (!data?.breed || !data.guide) {
    return (
      <div className="bg-gray-50 dark:bg-dark-bg rounded-xl p-3 text-xs text-gray-500">
        {isFetching ? 'Looking for a breed guide…' : <>No breed guide matches “{query}”. The batch will be recorded as usual but not benchmarked. A guide can be added on the Breed Standards page.</>}
      </div>
    );
  }

  const toggle = (key: string, on: boolean) => {
    const set = new Set(value.untrackedMetrics);
    if (on) set.delete(key); else set.add(key);
    onChange({ ...value, untrackedMetrics: [...set] });
  };
  const systemMetrics = data.recordable.filter(m => m.capture === 'SYSTEM');
  const lightMetric = data.recordable.find(m => m.key === 'LIGHT_HOURS');
  const sacrificed = systemMetrics.filter(m => value.untrackedMetrics.includes(m.key));

  return (
    <div className="border border-brand-green/30 bg-brand-green/5 rounded-xl p-3 space-y-3">
      <div className="flex items-start gap-2">
        <BookOpen className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {data.breed.name}{data.breed.variety ? ` (${data.breed.variety})` : ''} — benchmarked against the {data.guide.versionLabel} guide
          </p>
          <p className="text-[11px] text-gray-500">{data.guide.title}. Tick what the farm will record for this batch.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-1">
        {systemMetrics.map(m => {
          const on = !value.untrackedMetrics.includes(m.key);
          return (
            <label key={m.key} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={on} onChange={e => toggle(m.key, e.target.checked)} className="w-4 h-4 accent-brand-green" />
              {m.label}
            </label>
          );
        })}
      </div>

      {sacrificed.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-2.5 space-y-1.5">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Not recording — what the farm gives up
          </p>
          {sacrificed.map(m => (
            <p key={m.key} className="text-[11px] text-amber-800 dark:text-amber-300"><strong>{m.label}:</strong> {m.implication}</p>
          ))}
        </div>
      )}

      {data.notRecordable.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowNoInput(s => !s)} className="text-[11px] text-gray-500 flex items-center gap-1">
            {showNoInput ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Not measured at the farm ({data.notRecordable.map(m => m.label.split(' (')[0]).join(', ')})
          </button>
          {showNoInput && (
            <div className="mt-1.5 space-y-1">
              {data.notRecordable.map(m => (
                <p key={m.key} className="text-[11px] text-gray-500"><strong>{m.label}:</strong> {m.implication}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Housing / lighting type</label>
          <select value={value.housingType} onChange={e => onChange({ ...value, housingType: e.target.value as BreedSetup['housingType'] })} className={iCls}>
            <option value="LIGHT_CONTROLLED">Light-controlled</option>
            <option value="OPEN_SIDED">Open-sided (daylight)</option>
          </select>
        </div>
        {lightMetric && (
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Hours of light per day (optional)</label>
            <input type="number" min="0" max="24" step="0.5" value={value.declaredLightHours}
              onChange={e => onChange({ ...value, declaredLightHours: e.target.value })} className={iCls} placeholder="e.g. 16" />
          </div>
        )}
        <div className="md:col-span-2">
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Describe the house (optional)</label>
          <input value={value.housingDescription} onChange={e => onChange({ ...value, housingDescription: e.target.value })} className={iCls}
            placeholder="e.g. windows covered with gunias; some light through the roof" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Guide nutrition programme to compare with</label>
          <select value={value.nutritionProgram} onChange={e => onChange({ ...value, nutritionProgram: e.target.value as BreedSetup['nutritionProgram'] })} className={iCls}>
            <option value="BOTH">Both (economical and optimal)</option>
            <option value="ECONOMICAL">Economical performance</option>
            <option value="OPTIMAL">Optimal performance</option>
          </select>
        </div>
      </div>
      {lightMetric && value.declaredLightHours === '' && (
        <p className="text-[11px] text-gray-500">Light hours left blank: {lightMetric.implication}</p>
      )}
    </div>
  );
}
