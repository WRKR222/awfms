import React from 'react';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../../lib/api';
import { useBatches } from '../../hooks/useFlock';
import dayjs from 'dayjs';
import {
  Syringe, Plus, X, ChevronDown, ChevronUp,
  Info, CheckCircle, Clock,
} from 'lucide-react';

// ── Shared tooltip ─────────────────────────────────────────────────────────
function Tooltip({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <span className="relative group inline-flex items-center">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
        bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-2.5 py-1.5
        w-52 text-center leading-relaxed
        opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-lg
        after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2
        after:border-4 after:border-transparent after:border-t-gray-900 dark:after:border-t-gray-700">
        {tip}
      </span>
    </span>
  );
}

// ── Vaccination route config + style constants ───────────────────────────
const VAC_ROUTES = {
  DRINKING_WATER: { label: 'Drinking Water', tip: 'Vaccine mixed into drinking water — easiest for large flocks. Ensure water is withheld beforehand.' },
  EYE_DROP:       { label: 'Eye Drop',       tip: 'One drop per eye per bird. Precise but labour-intensive. Common for Newcastle disease.' },
  INJECTION:      { label: 'Injection',      tip: 'Subcutaneous or intramuscular injection. Highest efficacy but requires skilled handler.' },
  SPRAY:          { label: 'Spray',          tip: 'Aerosol spray into the house. Good for respiratory vaccines. Ensure correct droplet size.' },
  WING_WEB:       { label: 'Wing Web',       tip: 'Puncture through the wing web membrane. Used for fowl pox vaccine.' },
};

const BIOSECURITY_CHECKS = [
  { key: 'footbath',        label: 'Footbath used',          tip: 'Visitor walked through disinfectant footbath before entering the farm' },
  { key: 'handWash',        label: 'Hands washed/sanitised', tip: 'Hands washed with soap or sanitised with 70% alcohol' },
  { key: 'protectiveGear',  label: 'Protective gear worn',   tip: 'Visitor wore farm-provided overalls, gloves, and hairnet' },
  { key: 'noRecentPoultry', label: 'No poultry contact <48h', tip: 'Visitor has not been in contact with other poultry farms in the last 48 hours' },
  { key: 'purposeVerified', label: 'Purpose verified',       tip: 'Reason for visit confirmed and approved by management' },
];

const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-4 py-3 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const labelCls = 'block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide';
const cardCls  = 'bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm';

// ── Tab button ────────────────────────────────────────────────────────────────

// ── Vaccination form schema ──────────────────────────────────────────────────
const vacSchema = z.object({
  batchId:          z.string().uuid('Select a batch'),
  vaccineName:      z.string().min(1, 'Vaccine name required'),
  administeredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  route:            z.enum(['DRINKING_WATER', 'EYE_DROP', 'INJECTION', 'SPRAY', 'WING_WEB', 'OTHER']),
  batchSize:        z.coerce.number().int().min(1, 'Enter number of birds vaccinated'),
  dosageUnits:      z.string().optional(),
  vetName:          z.string().optional(),
  notes:            z.string().optional(),
});
type VacForm = z.infer<typeof vacSchema>;


function VaccinationForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: batches = [] } = useBatches({ isActive: true });
  const { register, handleSubmit, watch, formState: { errors } } = useForm<VacForm>({
    resolver: zodResolver(vacSchema),
    defaultValues: { administeredDate: dayjs().format('YYYY-MM-DD') },
  });

  const submit = useMutation({
    mutationFn: (data: VacForm) => api.post('/health/vaccinations', data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vaccinations'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[92vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-purple-500 rounded-xl flex items-center justify-center">
              <Syringe className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Log Vaccination</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">Record vaccine administration</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit(d => submit.mutate(d))} className="p-5 space-y-4">
          {/* Batch + Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Batch *</label>
              <select {...register('batchId')} className={inputCls}>
                <option value="">Select batch...</option>
                {batches.map((b: any) => (
                  <option key={b.id} value={b.id}>{b.batchCode} — {b.house?.name}</option>
                ))}
              </select>
              {errors.batchId && <p className="text-red-500 text-xs mt-1">{errors.batchId.message}</p>}
            </div>
            <div>
              <label className={labelCls}>Date Administered *</label>
              <input {...register('administeredDate')} type="date" className={inputCls} />
            </div>
          </div>

          {/* Vaccine name + vet */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Tooltip tip="Full commercial name of the vaccine — e.g. Newcastle LaSota, Gumboro IBD, Marek's Disease">
                <label className={`${labelCls} cursor-default flex items-center gap-1`}>
                  Vaccine Name * <Info className="w-3 h-3 opacity-40" />
                </label>
              </Tooltip>
              <input {...register('vaccineName')} className={inputCls} placeholder="e.g. Newcastle LaSota" />
              {errors.vaccineName && <p className="text-red-500 text-xs mt-1">{errors.vaccineName.message}</p>}
            </div>
            <div>
              <label className={labelCls}>Vet / Technician Name</label>
              <input {...register('vetName')} className={inputCls} placeholder="e.g. Dr. Kamau" />
            </div>
          </div>

          {/* Route */}
          <div>
            <Tooltip tip="Method used to administer the vaccine">
              <label className={`${labelCls} cursor-default flex items-center gap-1`}>
                Administration Route * <Info className="w-3 h-3 opacity-40" />
              </label>
            </Tooltip>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Object.entries(VAC_ROUTES).map(([val, cfg]) => (
                <Tooltip key={val} tip={cfg.tip}>
                  <label className="cursor-pointer w-full">
                    <input type="radio" {...register('route')} value={val} className="sr-only" />
                    <div className={`text-center py-2.5 px-2 rounded-xl border-2 text-xs font-semibold transition-colors
                      ${watch('route') === val
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400'
                        : 'border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 hover:border-gray-300'
                      }`}>
                      {cfg.label}
                    </div>
                  </label>
                </Tooltip>
              ))}
            </div>
            {errors.route && <p className="text-red-500 text-xs mt-1">{errors.route.message}</p>}
          </div>

          {/* Birds vaccinated + dosage */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Tooltip tip="Total number of birds that received this vaccine">
                <label className={`${labelCls} cursor-default flex items-center gap-1`}>
                  Birds Vaccinated * <Info className="w-3 h-3 opacity-40" />
                </label>
              </Tooltip>
              <input {...register('batchSize')} type="number" min="1" inputMode="numeric"
                className={`${inputCls} text-center text-xl font-bold`} />
              {errors.batchSize && <p className="text-red-500 text-xs mt-1">{errors.batchSize.message}</p>}
            </div>
            <div>
              <Tooltip tip="Dosage amount and unit — e.g. '0.2ml per bird', '1 dose per litre'">
                <label className={`${labelCls} cursor-default flex items-center gap-1`}>
                  Dosage <Info className="w-3 h-3 opacity-40" />
                </label>
              </Tooltip>
              <input {...register('dosageUnits')} className={inputCls} placeholder="e.g. 1 dose/litre" />
            </div>
          </div>

          <div>
            <label className={labelCls}>Notes (optional)</label>
            <textarea {...register('notes')} rows={2} className={`${inputCls} resize-none`}
              placeholder="Any observations during or after vaccination..." />
          </div>

          <button type="submit" disabled={submit.isPending}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white rounded-xl py-4 font-bold text-sm
              disabled:opacity-60 min-h-[52px] flex items-center justify-center gap-2 active:scale-[0.98] transition-all">
            {submit.isPending ? 'Logging...' : <><Syringe className="w-4 h-4" /> Log Vaccination</>}
          </button>
        </form>
      </div>
    </div>
  );
}


// ── Health Events Tab ─────────────────────────────────────────────────────────

function VaccinationsTab({ batchId }: { batchId: string | null }) {
  const [showForm, setShowForm] = useState(false);

  const { data: vaccinations = [], isLoading } = useQuery({
    queryKey: ['vaccinations', batchId],
    queryFn: () =>
      api
        .get('/health/vaccinations', { params: batchId ? { batchId } : {} })
        .then(r => r.data),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Clock className="w-5 h-5 animate-spin mr-2" /> Loading vaccinations…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {vaccinations.length} vaccination{vaccinations.length !== 1 ? 's' : ''} logged
        </p>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" /> Log Vaccination
        </button>
      </div>

      {vaccinations.length === 0 ? (
        <div className={cardCls + ' p-8 text-center'}>
          <Syringe className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No vaccinations recorded</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {batchId ? 'No vaccinations for this batch yet.' : 'Select a batch above or log a new vaccination.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {vaccinations.map((vac: any) => {
            const routeCfg = VAC_ROUTES[vac.route as keyof typeof VAC_ROUTES];
            return (
              <div key={vac.id} className={cardCls + ' p-4'}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center flex-shrink-0">
                    <Syringe className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">
                        {vac.vaccineName}
                      </p>
                      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                        {dayjs(vac.administeredDate).format('DD MMM YYYY')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {routeCfg && (
                        <span className="text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded-full font-medium">
                          {routeCfg.label}
                        </span>
                      )}
                      {vac.batchSize && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {vac.batchSize} birds
                        </span>
                      )}
                    </div>
                    {vac.vetName && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Administered by: {vac.vetName}
                      </p>
                    )}
                    {vac.dosageUnits && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Dosage: {vac.dosageUnits}
                      </p>
                    )}
                    {vac.notes && (
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 italic">{vac.notes}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && <VaccinationForm onClose={() => setShowForm(false)} />}
    </div>
  );
}

// ── Main Health page ──────────────────────────────────────────────────────────

// Health Events moved to Farm Events (ManagerCullingPage.tsx) per PM Activity Diagram.
// This page now shows Vaccinations only.
export function HealthBiosecurity() {
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const { data: batches = [] } = useBatches({ isActive: true });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Vaccinations</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Vaccination schedule · Records
        </p>
      </div>

      <div className={cardCls + ' p-4'}>
        <Tooltip tip="Select which flock batch to view or log vaccinations for">
          <label className={`${labelCls} cursor-default flex items-center gap-1`}>
            Select Batch <Info className="w-3 h-3 opacity-40" />
          </label>
        </Tooltip>
        <select
          value={selectedBatch ?? ''}
          onChange={e => setSelectedBatch(e.target.value || null)}
          className={inputCls}
        >
          <option value="">Choose a batch...</option>
          {batches.map((b: any) => (
            <option key={b.id} value={b.id}>{b.batchCode} — {b.house?.name}</option>
          ))}
        </select>
      </div>

      <VaccinationsTab batchId={selectedBatch} />
    </div>
  );
}

export default HealthBiosecurity;
