// frontend/src/pages/store/StoreVisitorsPage.tsx
// Fixes GAP-06: Store logs supplier / delivery-driver visitors in advance
// for Director approval (same /visitors/advance API as the Manager role).
//
// FIX: This page used to POST/GET against /health/visitors (the immediate
// gate check-in/out log) with field names that don't exist on that model at
// all (name, company, expectedArrival, approvalStatus...). That's a hard
// mismatch — the Store role also lacked permission for either endpoint — so
// every submit failed with "Failed to submit. Please try again." Rewired to
// the actual advance-notice endpoint (/health/visitors/advance) with the
// real VisitorAdvanceNotice field names, and added a client + server side
// guard so the expected arrival date/time can't be set in the past.
//
// HOW TO WIRE UP:
// 1. App.tsx: add  <Route path="visitors" element={<StoreVisitorsPage />} />
//    inside the /store block.
// 2. StoreLayout.tsx: add  { label: 'Visitors', icon: UserCheck, to: '/store/visitors' }
//    to navDefs (see StoreLayout.tsx.patch.txt).
// 3. Import UserCheck from lucide-react in StoreLayout.tsx.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Truck, Eye, X } from 'lucide-react';
import dayjs from '../../lib/dayjs';
import { api } from '../../lib/api/client';

type AdvanceNotice = {
  id: string;
  visitorName: string;
  phone?: string | null;
  purpose: string;
  organisation?: string | null;
  idNumber?: string | null;
  expectedDate: string;
  status: string;
  directorNote?: string | null;
  notes?: string | null;
  createdAt: string;
};

type FormData = {
  visitorName: string;
  phone?: string;
  purpose: string;
  organisation?: string;
  idNumber?: string;
  expectedDate: string;
  notes?: string;
};

// Minute-precision "now" for the datetime-local min attribute — recomputed
// on every render so the floor keeps moving forward while the form is open.
const nowLocalDateTime = () => dayjs().format('YYYY-MM-DDTHH:mm');

export default function StoreVisitorsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState<AdvanceNotice | null>(null);

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['store-visitors-advance'],
    queryFn: async () => (await api.get('/health/visitors/advance')).data as AdvanceNotice[],
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>();

  const createMut = useMutation({
    mutationFn: (data: FormData) => api.post('/health/visitors/advance', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['store-visitors-advance'] }); reset(); setShowForm(false); },
  });

  const statusColor = (s: string) =>
    s === 'APPROVED'  ? 'bg-emerald-100 text-emerald-700' :
    s === 'REJECTED'  ? 'bg-red-100 text-red-700' :
    s === 'PENDING'   ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-600';

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <header>
        <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-3">
          <Truck className="w-6 h-6 text-brand-green" /> Supplier Visitors
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Log advance visit requests for suppliers and delivery drivers.
          Each request is forwarded to the Director for approval — gate security is then notified automatically.
        </p>
      </header>

      <button onClick={() => setShowForm(v => !v)}
        className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
        <Plus className="w-4 h-4" /> {showForm ? 'Cancel' : 'Log Advance Visit'}
      </button>

      {showForm && (
        <form onSubmit={handleSubmit(d => createMut.mutate(d))}
          className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">New Supplier / Delivery Visit</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Fld label="Visitor Name *" err={errors.visitorName?.message}>
              <input {...register('visitorName', { required: 'Required' })} className="input" placeholder="Driver / Representative name" />
            </Fld>
            <Fld label="Phone">
              <input {...register('phone')} className="input" />
            </Fld>
            <Fld label="Company / Supplier">
              <input {...register('organisation')} className="input" placeholder="e.g. Unga Feeds Ltd" />
            </Fld>
            <Fld label="ID Number">
              <input {...register('idNumber')} className="input" />
            </Fld>
            <Fld label="Purpose *" err={errors.purpose?.message}>
              <input {...register('purpose', { required: 'Required' })}
                className="input" placeholder="e.g. Feed delivery — 5 bags layer mash" />
            </Fld>
            <Fld label="Expected Arrival Date/Time *" err={errors.expectedDate?.message}>
              <input
                type="datetime-local"
                min={nowLocalDateTime()}
                {...register('expectedDate', {
                  required: 'Required',
                  validate: (v) =>
                    !v || dayjs(v).isAfter(dayjs()) || dayjs(v).isSame(dayjs(), 'minute') ||
                    'Expected arrival cannot be in the past',
                })}
                className="input"
              />
            </Fld>
            <div className="md:col-span-2">
              <Fld label="Notes">
                <textarea rows={2} {...register('notes')} className="input" />
              </Fld>
            </div>
          </div>
          <button type="submit" disabled={createMut.isPending}
            className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
            {createMut.isPending ? 'Submitting…' : 'Submit for Director Approval'}
          </button>
          {createMut.isError && (
            <p className="text-xs text-red-600">
              {(createMut.error as any)?.response?.data?.message ?? 'Failed to submit. Please try again.'}
            </p>
          )}
        </form>
      )}

      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        {isLoading ? <div className="p-6 text-center text-sm text-gray-500">Loading…</div>
        : list.length === 0 ? (
          <div className="p-8 text-center">
            <Truck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No supplier visits logged yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Company</th>
                  <th className="text-left px-4 py-2">Purpose</th>
                  <th className="text-left px-4 py-2">Expected</th>
                  <th className="text-center px-4 py-2">Approval</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(v => (
                  <tr key={v.id} className="border-t border-gray-100 dark:border-dark-border hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-2 font-medium">{v.visitorName}</td>
                    <td className="px-4 py-2 text-gray-600">{v.organisation ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600 max-w-[200px] truncate">{v.purpose}</td>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                      {v.expectedDate ? dayjs(v.expectedDate).format('DD/MM/YY HH:mm') : '—'}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(v.status)}`}>
                        {v.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => setViewing(v)}
                        className="text-brand-green hover:underline text-xs inline-flex items-center gap-1">
                        <Eye className="w-3 h-3" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setViewing(null)}>
          <div className="bg-white dark:bg-dark-card rounded-2xl p-6 w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h2 className="font-bold text-lg text-gray-800 dark:text-gray-100">{viewing.visitorName}</h2>
              <button onClick={() => setViewing(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            {([
              ['Company', viewing.organisation], ['Phone', viewing.phone], ['ID Number', viewing.idNumber],
              ['Purpose', viewing.purpose],
              ['Expected', viewing.expectedDate ? dayjs(viewing.expectedDate).format('DD/MM/YYYY HH:mm') : null],
              ['Notes', viewing.notes],
              ['Approval Status', viewing.status],
              ['Director Note', viewing.directorNote],
              ['Logged', dayjs(viewing.createdAt).format('DD/MM/YYYY HH:mm')],
            ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm border-t border-gray-100 dark:border-dark-border pt-2 first:border-0 first:pt-0">
                <span className="text-gray-500 flex-shrink-0">{k}</span>
                <span className="text-gray-800 dark:text-gray-100 text-right ml-4">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`.input{width:100%;border-radius:.75rem;border:1px solid rgb(229 231 235);background:white;font-size:.875rem;padding:.5rem .75rem}.dark .input{background:rgb(31 41 55);border-color:rgb(55 65 81);color:white}`}</style>
    </div>
  );
}

function Fld({ label, err, children }: { label: string; err?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      {children}
      {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
    </div>
  );
}
