// src/pages/store/inventory/ItemsTab.tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Search, AlertTriangle, Pencil } from 'lucide-react';
import { api } from '../../lib/api/client';
import { fmtKES, useStoreItems, type StoreItem } from './_shared';

const CATEGORIES = ['FEED', 'MEDICATION', 'EQUIPMENT', 'CONSUMABLES', 'PACKAGING', 'OTHER'];
const UNITS = ['KG', 'LITRES', 'BAGS', 'PIECES', 'BOXES', 'METERS', 'TRAYS'];

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
    mutationFn: (data: FormData) => api.post('/store/inventory/items', {
      ...data,
      reorderLevel: Number(data.reorderLevel ?? 0),
      unitCostKes:  Number(data.unitCostKes ?? 0),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['store-items'] });
      reset(); setShowForm(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FormData> & { isActive?: boolean } }) =>
      api.patch(`/store/inventory/items/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['store-items'] });
      setEditing(null); reset(); setShowForm(false);
    },
  });

  const onSubmit = (data: FormData) => {
    if (editing) updateMut.mutate({ id: editing.id, data: { ...data, reorderLevel: Number(data.reorderLevel ?? 0), unitCostKes: Number(data.unitCostKes ?? 0) } });
    else         createMut.mutate(data);
  };

  const startEdit = (item: StoreItem) => {
    setEditing(item);
    reset({
      name: item.name, sku: item.sku, category: item.category, unit: item.unit,
      description: item.description ?? '', reorderLevel: item.reorderLevel,
      unitCostKes: Number(item.unitCostKes),
    });
    setShowForm(true);
  };

  const filtered = items.filter(i => {
    if (category && i.category !== category) return false;
    if (search && !`${i.name} ${i.sku}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => { setEditing(null); reset({ name:'', sku:'', category:'', unit:'', description:'', reorderLevel:0, unitCostKes:0 }); setShowForm(v => !v); }}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold"
        >
          <Plus className="w-4 h-4" /> {showForm ? 'Cancel' : 'New Item'}
        </button>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or SKU"
            className="w-full pl-9 pr-3 py-2 rounded-xl text-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800"
          />
        </div>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="rounded-xl text-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 px-3 py-2"
        >
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <h3 className="font-semibold text-gray-700 dark:text-gray-200 text-sm">{editing ? `Edit Item — ${editing.sku}` : 'Create New Item'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name *" error={errors.name?.message}>
              <input {...register('name', { required: 'Required' })} className="input" />
            </Field>
            <Field label="SKU *" error={errors.sku?.message}>
              <input {...register('sku', { required: 'Required' })} disabled={!!editing} className="input disabled:opacity-60" />
            </Field>
            <Field label="Category *">
              <select {...register('category', { required: true })} className="input">
                <option value="">Select…</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Unit *">
              <select {...register('unit', { required: true })} className="input">
                <option value="">Select…</option>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Reorder Level">
              <input type="number" step="any" {...register('reorderLevel')} className="input" />
            </Field>
            <Field label="Unit Cost (KES)">
              <input type="number" step="any" {...register('unitCostKes')} className="input" />
            </Field>
            <div className="md:col-span-2">
              <Field label="Description">
                <textarea {...register('description')} rows={2} className="input" />
              </Field>
            </div>
          </div>

          <div className="flex gap-2">
            <button type="submit" disabled={createMut.isPending || updateMut.isPending}
              className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
              {editing ? 'Save Changes' : 'Create Item'}
            </button>
            {editing && (
              <button type="button"
                onClick={() => updateMut.mutate({ id: editing.id, data: { isActive: !editing.isActive } })}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-dark-border">
                {editing.isActive ? 'Deactivate' : 'Activate'}
              </button>
            )}
          </div>
          {(createMut.isError || updateMut.isError) && (
            <p className="text-xs text-red-600">Failed to save item.</p>
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
                  <th className="text-left px-4 py-2">SKU</th>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Category</th>
                  <th className="text-right px-4 py-2">Stock</th>
                  <th className="text-right px-4 py-2">Reorder</th>
                  <th className="text-right px-4 py-2">Unit Cost</th>
                  <th className="text-center px-4 py-2">Status</th>
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
                      <td className="px-4 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${i.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                          {i.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
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
