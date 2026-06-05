import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import {
  Users, Plus, CheckCircle, Clock, LogOut, Calendar, AlertCircle,
  ChevronDown, ChevronUp, X, Check,
} from 'lucide-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);

// ── Biosecurity checks for walk-in visitor log entry ─────────────────────────
// changes.pdf — Production Manager → Visitors: add a "PPE" check using the
// same checkbox-on-the-left layout as the other biosecurity items.
const BIOSECURITY_CHECKS = [
  { id: 'footbath_used',    label: 'Footbath used at entry' },
  { id: 'hands_sanitised',  label: 'Hands sanitised' },
  { id: 'ppe_worn',         label: 'PPE (mask, gloves, head cover) worn' },
  { id: 'overalls_worn',    label: 'Farm overalls worn' },
  { id: 'boots_changed',    label: 'Dedicated farm boots used' },
  { id: 'no_other_farms',   label: 'Confirmed no other farm visits in last 72h' },
  { id: 'purpose_stated',   label: 'Purpose of visit verified' },
];

type Tab = 'log' | 'advance' | 'history';

interface VisitorForm {
  visitorName: string;
  organisation: string;
  purpose: string;
  houseId: string;
  advanceNoticeId: string;
  biosecurityChecks: Record<string, boolean>;
}

interface AdvanceForm {
  visitorName: string;
  organisation: string;
  purpose: string;
  expectedDate: string;
  expectedCount: string;
}

const emptyForm = (): VisitorForm => ({
  visitorName: '', organisation: '', purpose: '', houseId: '', advanceNoticeId: '',
  biosecurityChecks: Object.fromEntries(BIOSECURITY_CHECKS.map(c => [c.id, false])),
});

export function VisitorManagementPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('log');
  const [form, setForm] = useState<VisitorForm>(emptyForm());
  const [advForm, setAdvForm] = useState<AdvanceForm>({ visitorName: '', organisation: '', purpose: '', expectedDate: dayjs().add(1, 'day').format('YYYY-MM-DD'), expectedCount: '1' });
  const [logDone, setLogDone] = useState(false);
  const [advDone, setAdvDone] = useState(false);
  const [expandedVisitor, setExpandedVisitor] = useState<string | null>(null);

  // Fetch active visitors (checked in, not checked out)
  const { data: visitors = [] } = useQuery({
    queryKey: ['visitors'],
    queryFn: () => api.get('/health/visitors?days=1').then(r => r.data),
    refetchInterval: 60_000,
  });

  const { data: history = [] } = useQuery({
    queryKey: ['visitors-history'],
    queryFn: () => api.get('/health/visitors?days=30').then(r => r.data),
    enabled: tab === 'history',
  });

  const { data: advanceNotices = [] } = useQuery({
    queryKey: ['advance-notices'],
    queryFn: () => api.get('/health/visitors/advance').then(r => r.data),
  });

  const { data: housesRaw = [] } = useQuery({
    queryKey: ['houses'],
    queryFn: () => api.get('/flock/houses').then(r => r.data).catch(() => []),
  });
  // Deduplicate by id — prevents duplicate 'Brooder House' entries
  const houses = (housesRaw as any[]).filter(
    (h: any, idx: number, arr: any[]) => arr.findIndex((x: any) => x.id === h.id) === idx
  );

  const logVisitorMutation = useMutation({
    mutationFn: (data: object) => api.post('/health/visitors', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['visitors'] }); setLogDone(true); },
  });

  const checkOutMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/health/visitors/${id}/checkout`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visitors'] }),
  });

  const advanceMutation = useMutation({
    mutationFn: (data: object) => api.post('/health/visitors/advance', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['advance-notices'] }); setAdvDone(true); },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: string; note?: string }) =>
      api.patch(`/health/visitors/advance/${id}/status`, { status, directorNote: note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['advance-notices'] }),
  });

  const handleLogVisitor = () => {
    if (!form.visitorName || !form.purpose) return;
    logVisitorMutation.mutate({
      visitorName: form.visitorName,
      organisation: form.organisation || undefined,
      purpose: form.purpose,
      checkInAt: new Date().toISOString(),
      houseId: form.houseId || undefined,
      biosecurityChecks: form.biosecurityChecks,
      advanceNoticeId: form.advanceNoticeId || undefined,
    });
  };

  const handleAdvanceNotice = () => {
    if (!advForm.visitorName || !advForm.purpose) return;
    advanceMutation.mutate({
      visitorName: advForm.visitorName,
      organisation: advForm.organisation || undefined,
      purpose: advForm.purpose,
      expectedDate: advForm.expectedDate,
      expectedCount: parseInt(advForm.expectedCount) || 1,
    });
  };

  const activeVisitors = visitors.filter((v: any) => !v.checkOutAt);
  const pendingNotices = advanceNotices.filter((n: any) => n.status === 'PENDING');

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors relative ${
        tab === t ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 shadow-sm' : 'text-gray-500'
      }`}
    >
      {label}
      {t === 'advance' && pendingNotices.length > 0 && (
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
          {pendingNotices.length}
        </span>
      )}
    </button>
  );

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-green" /> Visitor Management
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">{dayjs().format('dddd, D MMM YYYY')}</p>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
          {tabBtn('log', 'Log In')}
          {tabBtn('advance', 'Advance')}
          {tabBtn('history', 'History')}
        </div>
      </div>

      {/* Active visitors strip */}
      {activeVisitors.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-3 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {activeVisitors.length} visitor{activeVisitors.length > 1 ? 's' : ''} currently on site
          </p>
          <div className="space-y-2">
            {activeVisitors.map((v: any) => (
              <div key={v.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-xl px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{v.visitorName}</p>
                  <p className="text-xs text-gray-500">In {dayjs(v.checkInAt).fromNow()} · {v.purpose}</p>
                </div>
                <button
                  onClick={() => checkOutMutation.mutate(v.id)}
                  disabled={checkOutMutation.isPending}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" /> Check Out
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Log In tab ────────────────────────────────────────────────────── */}
      {tab === 'log' && (
        logDone ? (
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 flex flex-col items-center gap-4 text-center border border-gray-100 dark:border-gray-800">
            <CheckCircle className="w-14 h-14 text-brand-green" />
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Visitor Logged In</h2>
            <p className="text-sm text-gray-500">Biosecurity checks recorded.</p>
            <button onClick={() => { setForm(emptyForm()); setLogDone(false); }} className="px-5 py-2 bg-brand-green text-white rounded-xl text-sm font-medium">
              Log Another
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Visitor details */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-100 dark:border-gray-800 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Visitor Details</h3>

              {/* Link to advance notice if any approved */}
              {advanceNotices.filter((n: any) => n.status === 'APPROVED' && dayjs(n.expectedDate).isSame(dayjs(), 'day')).length > 0 && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Link to pre-registered visit (optional)</label>
                  <select
                    value={form.advanceNoticeId}
                    onChange={e => {
                      const notice = advanceNotices.find((n: any) => n.id === e.target.value);
                      if (notice) setForm(p => ({ ...p, advanceNoticeId: e.target.value, visitorName: notice.visitorName, organisation: notice.organisation ?? '', purpose: notice.purpose }));
                      else setForm(p => ({ ...p, advanceNoticeId: '' }));
                    }}
                    className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green/30"
                  >
                    <option value="">— Walk-in / not pre-registered —</option>
                    {advanceNotices.filter((n: any) => n.status === 'APPROVED' && dayjs(n.expectedDate).isSame(dayjs(), 'day')).map((n: any) => (
                      <option key={n.id} value={n.id}>{n.visitorName}{n.organisation ? ` — ${n.organisation}` : ''}</option>
                    ))}
                  </select>
                </div>
              )}

              {[
                { key: 'visitorName', label: 'Visitor Name', placeholder: 'Full name', required: true },
                { key: 'organisation', label: 'Organisation', placeholder: 'Company / institution (optional)', required: false },
                { key: 'purpose', label: 'Purpose of Visit', placeholder: 'e.g. Vet inspection, feed delivery…', required: true },
              ].map(({ key, label, placeholder, required }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-1">{label}{required && ' *'}</label>
                  <input
                    value={(form as any)[key]}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-green/30"
                  />
                </div>
              ))}

              {houses.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Houses to be visited</label>
                  <select
                    value={form.houseId}
                    onChange={e => setForm(p => ({ ...p, houseId: e.target.value }))}
                    className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green/30"
                  >
                    <option value="">— General site access —</option>
                    {houses.map((h: any) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Biosecurity checklist */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Biosecurity Checks</h3>
              <div className="space-y-2.5">
                {BIOSECURITY_CHECKS.map(check => (
                  <label key={check.id} className="flex items-center gap-3 cursor-pointer group">
                    <div
                      onClick={() => setForm(p => ({ ...p, biosecurityChecks: { ...p.biosecurityChecks, [check.id]: !p.biosecurityChecks[check.id] } }))}
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                        form.biosecurityChecks[check.id]
                          ? 'bg-brand-green border-brand-green'
                          : 'border-gray-300 dark:border-gray-600 group-hover:border-brand-green/50'
                      }`}
                    >
                      {form.biosecurityChecks[check.id] && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">{check.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleLogVisitor}
              disabled={!form.visitorName || !form.purpose || logVisitorMutation.isPending}
              className="w-full py-3 rounded-2xl bg-brand-green text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {logVisitorMutation.isPending
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Logging…</>
                : <><Plus className="w-4 h-4" /> Log Visitor Check-In</>}
            </button>
          </div>
        )
      )}

      {/* ── Advance Notice tab ────────────────────────────────────────────── */}
      {tab === 'advance' && (
        <div className="space-y-4">
          {/* Pending approvals from Director */}
          {advanceNotices.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">All Advance Notices</h3>
              {advanceNotices.map((n: any) => {
                const isExpanded = expandedVisitor === n.id;
                const statusColors: Record<string, string> = {
                  PENDING:   'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
                  APPROVED:  'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
                  REJECTED:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
                  COMPLETED: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
                };
                return (
                  <div key={n.id} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                    <button
                      onClick={() => setExpandedVisitor(isExpanded ? null : n.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 text-left"
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{n.visitorName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Expected {dayjs(n.expectedDate).format('D MMM YYYY')} · {n.purpose}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[n.status]}`}>
                          {n.status}
                        </span>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-gray-50 dark:border-gray-800 pt-3 space-y-2">
                        {n.organisation && <p className="text-xs text-gray-500">Organisation: {n.organisation}</p>}
                        <p className="text-xs text-gray-500">Count: {n.expectedCount} person{n.expectedCount > 1 ? 's' : ''}</p>
                        {n.directorNote && (
                          <p className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                            Director note: {n.directorNote}
                          </p>
                        )}
                        {/* Director approval actions — only if OWNER role */}
                        {user?.role === 'OWNER' && n.status === 'PENDING' && (
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={() => updateStatusMutation.mutate({ id: n.id, status: 'APPROVED' })}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-medium"
                            >
                              <Check className="w-3.5 h-3.5" /> Approve
                            </button>
                            <button
                              onClick={() => {
                                const note = prompt('Reason for rejection (optional):') ?? undefined;
                                updateStatusMutation.mutate({ id: n.id, status: 'REJECTED', note });
                              }}
                              className="flex items-center gap-1 px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-lg text-xs font-medium"
                            >
                              <X className="w-3.5 h-3.5" /> Reject
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* New advance notice form */}
          {advDone ? (
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 flex flex-col items-center gap-4 text-center border border-gray-100 dark:border-gray-800">
              <CheckCircle className="w-14 h-14 text-brand-green" />
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Notice Submitted</h2>
              <p className="text-sm text-gray-500">Director has been notified for approval.</p>
              <button onClick={() => { setAdvForm({ visitorName: '', organisation: '', purpose: '', expectedDate: dayjs().add(1, 'day').format('YYYY-MM-DD'), expectedCount: '1' }); setAdvDone(false); }} className="px-5 py-2 bg-brand-green text-white rounded-xl text-sm font-medium">
                Add Another
              </button>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-100 dark:border-gray-800 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-brand-green" /> Pre-Register Expected Visitor
              </h3>
              {[
                { key: 'visitorName', label: 'Visitor Name *', placeholder: 'Full name', type: 'text' },
                { key: 'organisation', label: 'Organisation', placeholder: 'Company / institution', type: 'text' },
                { key: 'purpose', label: 'Purpose *', placeholder: 'Reason for visit', type: 'text' },
                { key: 'expectedDate', label: 'Expected Date *', placeholder: '', type: 'date' },
                { key: 'expectedCount', label: 'Number of visitors', placeholder: '1', type: 'number' },
              ].map(({ key, label, placeholder, type }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                  <input
                    type={type}
                    value={(advForm as any)[key]}
                    onChange={e => setAdvForm(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    min={type === 'date' ? dayjs().format('YYYY-MM-DD') : undefined}
                    className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-green/30"
                  />
                </div>
              ))}
              <button
                onClick={handleAdvanceNotice}
                disabled={!advForm.visitorName || !advForm.purpose || advanceMutation.isPending}
                className="w-full py-2.5 rounded-xl bg-brand-green text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {advanceMutation.isPending
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Submitting…</>
                  : <><Calendar className="w-4 h-4" /> Submit for Director Approval</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── History tab ───────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div className="space-y-3">
          {history.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 text-center border border-gray-100 dark:border-gray-800">
              <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No visitor records in the last 30 days</p>
            </div>
          ) : history.map((v: any) => (
            <div key={v.id} className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-100 dark:border-gray-800">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{v.visitorName}</p>
                  {v.organisation && <p className="text-xs text-gray-500 truncate">{v.organisation}</p>}
                  <p className="text-xs text-gray-500 mt-0.5">{v.purpose}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    In: {dayjs(v.checkInAt).format('D MMM HH:mm')}
                    {v.checkOutAt
                      ? ` · Out: ${dayjs(v.checkOutAt).format('HH:mm')} (${dayjs(v.checkOutAt).diff(dayjs(v.checkInAt), 'minute')}m)`
                      : ' · Still on site'}
                  </p>
                </div>
                {v.checkOutAt ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs rounded-full font-medium flex-shrink-0">
                    <CheckCircle className="w-3 h-3" /> Out
                  </span>
                ) : (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs rounded-full font-medium flex-shrink-0">
                    <Clock className="w-3 h-3" /> On site
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
