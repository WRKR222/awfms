import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import { CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronUp, Save, Clock } from 'lucide-react';
import dayjs from 'dayjs';

// ── Static checklist definition (configurable later via Director input) ──────
const CHECKLIST_SECTIONS = [
  {
    title: 'Bird Behaviour & Appearance',
    items: [
      { id: 'feeding_normal',     label: 'Birds feeding normally' },
      { id: 'drinking_normal',    label: 'Birds drinking normally' },
      { id: 'movement_normal',    label: 'Normal movement and activity levels' },
      { id: 'no_huddling',        label: 'No huddling or drooping birds observed' },
      { id: 'eyes_clear',         label: 'Eyes clear — no discharge or cloudiness' },
      { id: 'feathers_normal',    label: 'Feathers in good condition — no excessive moulting' },
      { id: 'combs_normal',       label: 'Combs and wattles healthy colour (no pale/cyanosis)' },
    ],
  },
  {
    title: 'Respiratory & Digestive',
    items: [
      { id: 'no_coughing',        label: 'No coughing, sneezing, or wheezing heard' },
      { id: 'no_nasal_discharge', label: 'No nasal discharge observed' },
      { id: 'droppings_normal',   label: 'Droppings normal consistency and colour' },
      { id: 'no_bloody_droppings', label: 'No blood in droppings' },
      { id: 'no_diarrhoea',       label: 'No signs of diarrhoea' },
    ],
  },
  {
    title: 'House Environment',
    items: [
      { id: 'litter_dry',         label: 'Litter dry and friable — no wet patches' },
      { id: 'ventilation_ok',     label: 'Ventilation adequate — no ammonia smell' },
      { id: 'lighting_ok',        label: 'Lighting programme running correctly' },
      { id: 'feeders_clean',      label: 'Feeders clean and not blocked' },
      { id: 'drinkers_clean',     label: 'Drinkers clean, no algae or blockages' },
      { id: 'no_pests',           label: 'No rodents or pest activity observed' },
    ],
  },
  {
    title: 'Biosecurity',
    items: [
      { id: 'footbath_active',    label: 'Footbath solution active and at correct strength' },
      { id: 'doors_secured',      label: 'All house doors secured when not in use' },
      { id: 'no_dead_birds_in_house', label: 'No dead birds left unattended in house' },
      { id: 'disposal_done',      label: 'Dead bird disposal done per protocol' },
    ],
  },
];

type CheckState = Record<string, 'pass' | 'fail' | 'na'>;
type NoteMap = Record<string, string>;

function StatusButton({ state, label, onClick }: {
  state: 'pass' | 'fail' | 'na';
  label: string;
  onClick: () => void;
}) {
  const styles = {
    pass: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700',
    fail: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700',
    na:   'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600',
  };
  return (
    <button onClick={onClick} className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${styles[state]}`}>
      {label}
    </button>
  );
}

export function HealthChecklistPage() {
  const { user } = useAuthStore();
  const today = dayjs().format('YYYY-MM-DD');
  const [shift, setShift] = useState<'AM' | 'PM'>('AM');
  const [checks, setChecks] = useState<CheckState>({});
  const [notes, setNotes] = useState<NoteMap>({});
  const [overallNotes, setOverallNotes] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);

  // Fetch active batches for context
  const { data: batches = [] } = useQuery({
    queryKey: ['batches-active'],
    queryFn: () => api.get('/flock/batches?isActive=true').then(r => r.data),
  });

  const [batchId, setBatchId] = useState('');

  const submitMutation = useMutation({
    mutationFn: (payload: object) => api.post('/health/events', payload),
    onSuccess: () => setSubmitted(true),
  });

  const setCheck = (itemId: string, val: 'pass' | 'fail' | 'na') => {
    setChecks(prev => ({ ...prev, [itemId]: val }));
  };

  const toggleSection = (title: string) => {
    setOpenSections(prev => ({ ...prev, [title]: !prev[title] }));
  };

  // Count stats
  const allIds = CHECKLIST_SECTIONS.flatMap(s => s.items.map(i => i.id));
  const answered = allIds.filter(id => checks[id]).length;
  const failed   = allIds.filter(id => checks[id] === 'fail').length;
  const total    = allIds.length;

  const handleSubmit = () => {
    if (!batchId) return; // batch required

    // Build a human-readable notes summary from the checklist results
    const failedItems = CHECKLIST_SECTIONS
      .flatMap(s => s.items)
      .filter(item => checks[item.id] === 'fail')
      .map(item => {
        const note = notes[item.id] ? ` — ${notes[item.id]}` : '';
        return `• ${item.label}${note}`;
      });

    const naCount = Object.values(checks).filter(v => v === 'na').length;
    const summary =
      `[${shift} Health Checklist] ${answered - failed} passed` +
      (naCount > 0 ? `, ${naCount} N/A` : '') +
      (failed > 0 ? `, ${failed} ISSUE(S) FLAGGED` : '') +
      '.';

    const notesText = [
      summary,
      ...(failedItems.length > 0 ? ['\nFailed items:', ...failedItems] : []),
      ...(overallNotes ? ['\nOverall notes: ' + overallNotes] : []),
    ].join('\n');

    const selectedBatch = (batches as any[]).find((b: any) => b.id === batchId);
    const affectedCount = selectedBatch?.currentBirdCount ?? 0;

    const payload = {
      batchId,
      eventType: 'ROUTINE_CHECKUP',
      eventDate: today,
      affectedCount,
      symptoms: failed > 0 ? failedItems.join('; ') : undefined,
      notes: notesText,
    };
    submitMutation.mutate(payload);
  };

  if (submitted) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
        <CheckCircle className="w-16 h-16 text-brand-green" />
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Checklist Submitted</h2>
        <p className="text-sm text-gray-500">
          {shift} routine health check for {today} logged as a health event.
          {failed > 0 && <span className="text-red-500 font-medium ml-1">{failed} issue(s) flagged for manager review.</span>}
        </p>
        <button
          onClick={() => { setChecks({}); setNotes({}); setOverallNotes(''); setBatchId(''); setSubmitted(false); }}
          className="mt-2 px-5 py-2 bg-brand-green text-white rounded-xl text-sm font-medium"
        >
          New Checklist
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Health Checklist</h1>
          <p className="text-xs text-gray-500 mt-0.5">{dayjs().format('dddd, D MMM YYYY')}</p>
        </div>
        <div className="flex gap-2">
          {(['AM', 'PM'] as const).map(s => (
            <button
              key={s}
              onClick={() => setShift(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                shift === s
                  ? 'bg-brand-green text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Batch selector ────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-100 dark:border-gray-800">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Batch / Flock *
        </label>
        {(batches as any[]).length === 0 ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">No active batches found — ask the Production Manager to register one first.</p>
        ) : (
          <select
            value={batchId}
            onChange={e => setBatchId(e.target.value)}
            className="w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green"
          >
            <option value="">— Select batch —</option>
            {(batches as any[]).map((b: any) => (
              <option key={b.id} value={b.id}>{b.batchCode} — {b.house?.name ?? ''} [{b.stage}]</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Progress bar ───────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {answered} / {total} items checked
          </p>
          {failed > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
              <AlertCircle className="w-3.5 h-3.5" />
              {failed} issue{failed > 1 ? 's' : ''} flagged
            </span>
          )}
        </div>
        <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-green rounded-full transition-all"
            style={{ width: `${(answered / total) * 100}%` }}
          />
        </div>
      </div>

      {/* ── Sections ───────────────────────────────────────────────────────── */}
      {CHECKLIST_SECTIONS.map(section => {
        const isOpen = openSections[section.title] !== false; // default open
        const sectionFailed = section.items.filter(i => checks[i.id] === 'fail').length;
        return (
          <div
            key={section.title}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden"
          >
            <button
              onClick={() => toggleSection(section.title)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{section.title}</span>
                {sectionFailed > 0 && (
                  <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs rounded-full font-medium">
                    {sectionFailed} issue{sectionFailed > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>

            {isOpen && (
              <div className="divide-y divide-gray-50 dark:divide-gray-800">
                {section.items.map(item => {
                  const state = checks[item.id];
                  return (
                    <div key={item.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-gray-700 dark:text-gray-300 flex-1 leading-snug">{item.label}</p>
                        <div className="flex gap-1.5 flex-shrink-0">
                          <StatusButton state={state === 'pass' ? 'pass' : 'na'} label="✓ OK" onClick={() => setCheck(item.id, 'pass')} />
                          <StatusButton state={state === 'fail' ? 'fail' : 'na'} label="✗ Issue" onClick={() => setCheck(item.id, 'fail')} />
                          <StatusButton state={state === 'na' ? 'na' : 'na'}    label="N/A"    onClick={() => setCheck(item.id, 'na')} />
                        </div>
                      </div>
                      {/* Note input for failures */}
                      {state === 'fail' && (
                        <input
                          className="mt-2 w-full text-xs border border-red-200 dark:border-red-800 rounded-lg px-3 py-1.5 bg-red-50 dark:bg-red-900/10 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300"
                          placeholder="Describe the issue observed…"
                          value={notes[item.id] ?? ''}
                          onChange={e => setNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Overall notes ──────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-100 dark:border-gray-800">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Overall Notes / Observations
        </label>
        <textarea
          rows={3}
          value={overallNotes}
          onChange={e => setOverallNotes(e.target.value)}
          placeholder="Any additional observations, unusual signs, or recommendations…"
          className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-green/30 resize-none"
        />
      </div>

      {/* ── Submit ─────────────────────────────────────────────────────────── */}
      <button
        onClick={handleSubmit}
        disabled={answered < total || submitMutation.isPending || !batchId}
        className="w-full py-3 rounded-2xl bg-brand-green text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {submitMutation.isPending ? (
          <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Submitting…</>
        ) : (
          <><Save className="w-4 h-4" /> Submit {shift} Health Checklist</>
        )}
      </button>
      {answered < total && (
        <p className="text-center text-xs text-gray-400 flex items-center justify-center gap-1">
          <Clock className="w-3.5 h-3.5" /> Answer all {total - answered} remaining items to submit
        </p>
      )}
      {!batchId && answered === total && (
        <p className="text-center text-xs text-amber-500 flex items-center justify-center gap-1">
          <Clock className="w-3.5 h-3.5" /> Select a batch above to submit
        </p>
      )}

      {submitMutation.isError && (
        <p className="text-center text-xs text-red-500">
          {(submitMutation.error as any)?.response?.data?.message ?? 'Submission failed — check your connection and try again.'}
        </p>
      )}
    </div>
  );
}
