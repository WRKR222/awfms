// src/pages/store/inventory/ItemsTab.tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Search, AlertTriangle, Pencil } from 'lucide-react';
import { api } from '../../lib/api/client';
import { fmtKES, useStoreItems, type StoreItem } from './_shared';

const CATEGORIES = [
  { value: 'MEDICATION',      label: 'Medication' },
  { value: 'EQUIPMENT',       label: 'Equipment' },
  { value: 'FEED_SUPPLEMENT', label: 'Feed / Feed Supplement' },
  { value: 'PACKAGING',       label: 'Packaging' },
  { value: 'CLEANING',        label: 'Cleaning' },
  { value: 'SAFETY',          label: 'Safety' },
  { value: 'OTHER',           label: 'Other' },
];
const UNITS = [
  { value: 'KG',     label: 'Kilograms (kg)' },
  { value: 'G',      label: 'Grams (g)' },
  { value: 'L',      label: 'Litres (L)' },
  { value: 'ML',     label: 'Millilitres (mL)' },
  { value: 'PIECE',  label: 'Pieces' },
  { value: 'BOX',    label: 'Boxes' },
  { value: 'BAG',    label: 'Bags' },
  { value: 'BOTTLE', label: 'Bottles' },
  { value: 'SACHET', label: 'Sachets' },
  { value: 'TRAY',   label: 'Trays' },
];

type FormData = {
  name: string;
  sku: string;
  category: string;
  unit: string;
  description?: string;
  reorderLevel?: number;
  unitCostKes?: number;
};

export function ItemsTab() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useStoreItems(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StoreItem | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>();

  const createMut = useMutation({
    mutationFn: (data: FormData) =>
      api.post('/store/inventory/items', {
        name:         data.name,
        sku:          data.sku,
        category:     data.category,
        unit:         data.unit,
        description:  data.description ?? '',
        reorderLevel: Number(data.reorderLevel ?? 0),
        unitCostKes:  Number(data.unitCostKes ?? 0),
      }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['store-items'] });
      reset();
      setShowForm(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch(`/store/inventory/items/${id}`, payload).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['store-items'] });
      setEditing(null);
      reset();
      setShowForm(false);
    },
  });

  // Safely convert form number fields — empty strings become 0, never NaN
  const safeNum = (v: unknown) => {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };

  const onSubmit = (data: FormData) => {
    if (editing) {
      // Only send fields the backend UpdateStoreItemDto accepts — never send sku
      updateMut.mutate({
        id: editing.id,
        payload: {
          name:         data.name.trim(),
          category:     data.category,
          unit:         data.unit,
          description:  data.description?.trim() ?? '',
          reorderLevel: safeNum(data.reorderLevel),
          unitCostKes:  safeNum(data.unitCostKes),
        },
      });
    } else {
      createMut.mutate({
        ...data,
        reorderLevel: safeNum(data.reorderLevel),
        unitCostKes:  safeNum(data.unitCostKes),
      });
    }
  };

  const startEdit = (item: StoreItem) => {
    setEditing(item);
    createMut.reset();
    updateMut.reset();
    reset({
      name:         item.name,
      sku:          item.sku,
      category:     item.category,
      unit:         item.unit,
      description:  item.description ?? '',
      reorderLevel: item.reorderLevel,
      unitCostKes:  Number(item.unitCostKes),
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setEditing(null);
    createMut.reset();
    updateMut.reset();
    reset();
    setShowForm(false);
  };

  const filtered = items.filter(i => {
    if (category && i.category !== category) return false;
    if (search && !`${i.name} ${i.sku}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const isSaving = createMut.isPending || updateMut.isPending;
  const saveError =
    (createMut.error as any)?.response?.data?.message ??
    (updateMut.error as any)?.response?.data?.message ??
    null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            if (showForm) { closeForm(); return; }
            setEditing(null);
            createMut.reset();
            updateMut.reset();
            reset({ name: '', sku: '', category: '', unit: '', description: '', reorderLevel: 0, unitCostKes: 0 });
            setShowForm(true);
          }}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold"
        >
          <Plus className="w-4 h-4" /> {showForm ? 'Cancel' : 'New Item'}
        </button>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or Item Code"
            className="w-full pl-9 pr-3 py-2 rounded-xl text-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800"
          />
        </div>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="rounded-xl text-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 px-3 py-2"
        >
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <h3 className="font-semibold text-gray-700 dark:text-gray-200 text-sm">
            {editing ? `Edit Item — ${editing.sku}` : 'Create New Item'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name *" error={errors.name?.message}>
              <input {...register('name', { required: 'Required' })} className="input" />
            </Field>
            <Field label="Item Code *" error={errors.sku?.message}>
              <input
                {...register('sku', { required: 'Required' })}
                disabled={!!editing}
                className="input disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </Field>
            <Field label="Category *">
              <select {...register('category', { required: true })} className="input">
                <option value="">Select…</option>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Unit *">
              <select {...register('unit', { required: true })} className="input">
                <option value="">Select…</option>
                {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </Field>
            <Field label="Reorder Level">
              <input type="number" step="any" min="0" {...register('reorderLevel')} className="input" />
            </Field>
            <Field label="Unit Cost (KES)">
              <input type="number" step="any" min="0" {...register('unitCostKes')} className="input" />
            </Field>
            <div className="md:col-span-2">
              <Field label="Description">
                <textarea {...register('description')} rows={2} className="input" />
              </Field>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isSaving}
              className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : editing ? 'Save Changes' : 'Create Item'}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-300"
            >
              Cancel
            </button>
          </div>

          {(createMut.isError || updateMut.isError) && (
            <p className="text-xs text-red-600">
              {saveError ?? 'Failed to save item.'}
            </p>
          )}
        </form>
      )}

      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-center text-gray-500 text-sm">Loading items…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">No items found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Item Code</th>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Category</th>
                  <th className="text-right px-4 py-2">Stock</th>
                  <th className="text-right px-4 py-2">Reorder</th>
                  <th className="text-right px-4 py-2">Unit Cost</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(i => {
                  const low = Number(i.currentStock) <= Number(i.reorderLevel);
                  return (
                    <tr key={i.id} className="border-t border-gray-100 dark:border-dark-border">
                      <td className="px-4 py-2 font-mono text-xs">{i.sku}</td>
                      <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-100">{i.name}</td>
                      <td className="px-4 py-2 text-gray-500">{i.category}</td>
                      <td className={`px-4 py-2 text-right font-semibold ${low ? 'text-orange-600' : ''}`}>
                        {low && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                        {Number(i.currentStock)} {i.unit}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500">{Number(i.reorderLevel)}</td>
                      <td className="px-4 py-2 text-right">{fmtKES(i.unitCostKes)}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => startEdit(i)} className="text-brand-green hover:underline text-xs inline-flex items-center gap-1">
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        .input { width:100%; border-radius:0.75rem; border:1px solid rgb(229 231 235); background:white; font-size:0.875rem; padding:0.5rem 0.75rem; }
        .dark .input { background:rgb(31 41 55); border-color:rgb(55 65 81); color:white; }
      `}</style>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  );
}
