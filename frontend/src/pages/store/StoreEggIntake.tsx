// src/pages/store/StoreEggIntake.tsx
// Store role — log egg intake independently per collection session

import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, CheckCircle, Egg, Package, AlertTriangle, Clock, ChevronRight,
} from 'lucide-react';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';

const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-base bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const numInput = 'w-full text-center border border-gray-200 dark:border-dark-border rounded-lg px-1 py-2 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const cardCls  = 'bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border';

const DEFAULT_ROW_CODES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

interface IntakeRow {
  rowCode: string;
  fullTrays: number;
  looseEggs: number;
  weightKg: number;
}

interface FormValues {
  sessionId: string;
  notes: string;
  rows: IntakeRow[];
}

export default function StoreEggIntake() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedSession, setSelectedSession] = useState<any>(null);

  // Pending sessions (PM sessions from today/yesterday with no store intake)
  const { data: pending = [], isLoading: loadingPending } = useQuery({
    queryKey: ['pending-intakes'],
    queryFn: () => api.get('/store/pending-intakes').then(r => r.data),
  });

  const { register, handleSubmit, watch, control, reset } = useForm<FormValues>({
    defaultValues: {
      sessionId: '',
      notes: '',
      rows: DEFAULT_ROW_CODES.map(code => ({
        rowCode: code,
        fullTrays: 0,
        looseEggs: 0,
        weightKg: 0,
      })),
    },
  });

  const { fields } = useFieldArray({ control, name: 'rows' });

  const submit = useMutation({
    mutationFn: (data: any) => api.post('/store/egg-intake', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-intakes'] });
      qc.invalidateQueries({ queryKey: ['store-summary'] });
    },
  });

  const rows = watch('rows');
  const totalFullTrays = rows.reduce((s, r) => s + Number(r.fullTrays ?? 0), 0);
  const totalLooseEggs = rows.reduce((s, r) => s + Number(r.looseEggs ?? 0), 0);
  const totalGoodEggs  = totalFullTrays * 30 + totalLooseEggs;
  const totalWeightKg  = rows.reduce((s, r) => s + Number(r.weightKg ?? 0), 0);

  function selectSession(session: any) {
    setSelectedSession(session);
    reset({ sessionId: session.id, notes: '', rows: DEFAULT_ROW_CODES.map(code => ({ rowCode: code, fullTrays: 0, looseEggs: 0, weightKg: 0 })) });
  }

  function onSubmit(data: FormValues) {
    if (!selectedSession) return;
    submit.mutate({
      sessionId: data.sessionId,
      houseId: selectedSession.houseId,
      intakeDate: dayjs().format('YYYY-MM-DD'),
      shift: selectedSession.shift,
      rowData: data.rows.map(r => ({
        rowCode: r.rowCode,
        fullTrays: Number(r.fullTrays),
        looseEggs: Number(r.looseEggs),
        weightKg: Number(r.weightKg),
      })),
      notes: data.notes || undefined,
    });
  }

  // Step 1: Select session
  if (!selectedSession) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => navigate('/store')} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-card">
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Egg className="w-5 h-5 text-amber-500" /> Egg Intake
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Select the collection session to receive</p>
          </div>
        </div>

        {loadingPending ? (
          <div className="text-center py-12 text-gray-400">Loading sessions...</div>
        ) : pending.length === 0 ? (
          <div className={`${cardCls} text-center py-10`}>
            <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="font-semibold text-gray-500 dark:text-gray-400">No pending sessions</p>
            <p className="text-sm text-gray-400 mt-1">All egg collections have been received or none have been submitted yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {pending.length} session{pending.length > 1 ? 's' : ''} awaiting your intake log
            </p>

            {pending.map((session: any) => (
              <button
                key={session.id}
                onClick={() => selectSession(session)}
                className={`${cardCls} w-full text-left flex items-center justify-between hover:border-brand-green transition-colors`}
              >
                <div>
                  <p className="font-semibold text-gray-800 dark:text-gray-100">
                    {session.batch?.batchCode} — {session.shift} Session
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {dayjs(session.sessionDate).format('D MMM YYYY')} · {session.totalGoodEggs} good eggs reported · {session.totalFullTrays} trays
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Submitted by Lead Attendant
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Step 2: Fill intake form
  if (submit.isSuccess) {
    const diff = totalGoodEggs - (selectedSession?.totalGoodEggs ?? 0);
    const hasDisc = diff !== 0;
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-64 text-center max-w-lg mx-auto mt-20">
        <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Intake Logged!</h2>
        <p className="text-gray-500 mt-1">
          <span className="font-bold text-brand-green">{totalGoodEggs} good eggs</span> received · {totalFullTrays} full trays
        </p>
        {hasDisc && (
          <p className="mt-3 text-sm text-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-2">
            Discrepancy noted: Attendant reported {selectedSession.totalGoodEggs} eggs, you received {totalGoodEggs}.
            The Production Manager will review this during verification.
          </p>
        )}
        <div className="flex gap-3 mt-6">
          <button onClick={() => { setSelectedSession(null); submit.reset(); }} className="bg-gray-100 dark:bg-dark-card text-gray-700 dark:text-gray-200 rounded-xl px-6 py-3 font-semibold">
            Log Another
          </button>
          <button onClick={() => navigate('/store')} className="bg-brand-green text-white rounded-xl px-6 py-3 font-semibold">
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto pb-10">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => setSelectedSession(null)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-card">
          <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Log Egg Intake</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {selectedSession.batch?.batchCode} — {selectedSession.shift} · {dayjs(selectedSession.sessionDate).format('D MMM YYYY')}
          </p>
        </div>
      </div>

      {/* Attendant's report reference */}
      <div className="mb-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-4">
        <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1">Attendant's Report (Reference)</p>
        <div className="flex gap-6 text-sm">
          <span className="text-gray-700 dark:text-gray-200">Good eggs: <strong>{selectedSession.totalGoodEggs}</strong></span>
          <span className="text-gray-700 dark:text-gray-200">Full trays: <strong>{selectedSession.totalFullTrays}</strong></span>
          <span className="text-gray-700 dark:text-gray-200">Loose: <strong>{selectedSession.totalLooseEggs}</strong></span>
        </div>
        <p className="text-xs text-blue-500 mt-1">Fill your counts independently below — do not copy from above.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Row data */}
        <div className={cardCls}>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Eggs Received per Row</p>

          {/* Headers */}
          <div className="grid grid-cols-4 gap-2 mb-1 text-center">
            <div className="text-xs text-gray-400 font-medium">Row</div>
            <div className="text-xs text-gray-400 font-medium">Full Trays</div>
            <div className="text-xs text-gray-400 font-medium">Loose Eggs</div>
            <div className="text-xs text-gray-400 font-medium">Weight (kg)</div>
          </div>

          {fields.map((f, idx) => (
            <div key={f.id} className="grid grid-cols-4 gap-2 mb-1.5">
              <div className="flex items-center justify-center">
                <span className="text-xs font-bold text-brand-green bg-brand-green/10 rounded-lg px-3 py-2">
                  {rows[idx]?.rowCode}
                </span>
              </div>
              <input {...register(`rows.${idx}.fullTrays`)} type="number" min="0" inputMode="numeric" className={numInput} />
              <input {...register(`rows.${idx}.looseEggs`)} type="number" min="0" inputMode="numeric" className={numInput} />
              <input {...register(`rows.${idx}.weightKg`)} type="number" min="0" step="0.1" inputMode="decimal" className={numInput} />
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className={`${cardCls} grid grid-cols-2 md:grid-cols-4 gap-3`}>
          {[
            { label: 'Good Eggs', value: totalGoodEggs.toLocaleString(), cls: 'text-brand-green' },
            { label: 'Full Trays', value: totalFullTrays, cls: 'text-brand-green' },
            { label: 'Loose Eggs', value: totalLooseEggs, cls: 'text-gray-700 dark:text-gray-200' },
            { label: 'Weight (kg)', value: totalWeightKg.toFixed(1), cls: 'text-gray-700 dark:text-gray-200' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-gray-50 dark:bg-dark-bg rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400">{label}</p>
              <p className={`text-2xl font-bold mt-0.5 ${cls}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Discrepancy preview */}
        {totalGoodEggs !== selectedSession.totalGoodEggs && totalGoodEggs > 0 && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Your count ({totalGoodEggs}) differs from the attendant's ({selectedSession.totalGoodEggs}) by{' '}
              <strong>{Math.abs(totalGoodEggs - selectedSession.totalGoodEggs)}</strong> eggs.
              The Production Manager will review the discrepancy.
            </span>
          </div>
        )}

        <div className={cardCls}>
          <label className="block text-xs text-gray-500 mb-1">Notes (optional)</label>
          <textarea {...register('notes')} rows={2} className={`${inputCls} resize-none`} placeholder="Any observations during intake..." />
        </div>

        {submit.isError && (
          <p className="text-red-500 text-sm text-center">
            {(submit.error as any)?.response?.data?.message ?? 'Submission failed.'}
          </p>
        )}

        <button
          type="submit"
          disabled={submit.isPending}
          className="w-full bg-brand-green text-white rounded-2xl py-4 text-base font-bold shadow-lg disabled:opacity-60 hover:bg-green-800 transition-colors"
        >
          {submit.isPending ? 'Logging...' : `Confirm Receipt — ${totalGoodEggs} Good Eggs →`}
        </button>
      </form>
    </div>
  );
}
