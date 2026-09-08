// src/pages/store/inventory/ItemsTab.tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Search, AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api/client';
import { fmtKES, useStoreItems, type StoreItem } from './_shared';

// FEED_SUPPLEMENT is kept for legacy display but removed from creation options
export const CATEGORIES = [
  { value: 'MEDICATION',  label: 'Medication' },
  { value: 'EQUIPMENT',   label: 'Equipment' },
  { value: 'FEED',        label: 'Feed' },
  { value: 'SUPPLEMENT',  label: 'Supplement' },
  { value: 'VACCINE',     label: 'Vaccine' },
  { value: 'PACKAGING',   label: 'Packaging' },
  { value: 'CLEANING',    label: 'Cleaning' },
  { value: 'SAFETY',      label: 'Safety' },
  // Pick this when none of the above fit — the form then asks for a custom
  // category name (e.g. "Charcoal", "Disinfectant") instead of forcing the
  // item into a category that doesn't really describe it.
  { value: 'OTHER',       label: 'Other (custom)…' },
];

// Display label map — includes legacy value for existing items
export const CATEGORY_LABELS: Record<string, string> = {
  MEDICATION:      'Medication',
  EQUIPMENT:       'Equipment',
  FEED:            'Feed',
  SUPPLEMENT:      'Supplement',
  FEED_SUPPLEMENT: 'Feed / Supplement (legacy)',
  VACCINE:         'Vaccine',
  PACKAGING:       'Packaging',
  CLEANING:        'Cleaning',
  SAFETY:          'Safety',
  OTHER:           'Other',
};

/** Category label for display — a custom-named OTHER item shows its own
 *  name instead of the generic "Other". */
export function categoryDisplayLabel(item: { category: string; customCategoryLabel?: string | null }): string {
  if (item.category === 'OTHER' && item.customCategoryLabel) return item.customCategoryLabel;
  return CATEGORY_LABELS[item.category] ?? item.category;
}

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

// Sentinel option that reveals a free-text input for any unit not in the
// preset list above (e.g. "Roll", "Dozen", "Pair").
const CUSTOM_UNIT = '__CUSTOM__';
const PRESET_UNIT_VALUES = new Set(UNITS.map(u => u.value));

type FormData = {
  name: string;
  sku: string;
  category: string;
  customCategoryLabel?: string;
  unit: string;
  customUnit?: string;
  description?: string;
  reorderLevel?: number;
  unitCostKes?: number;
};

export function ItemsTab() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useStoreItems(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StoreItem | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<StoreItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormData>();
  const selectedUnit = watch('unit');
  const selectedCategory = watch('category');

  const invalidateItems = () => {
    qc.invalidateQueries({ queryKey: ['store-items'] });
  };

  const createMut = useMutation({
    mutationFn: (data: FormData) =>
      api.post('/store/inventory/items', {
        name:         data.name,
        sku:          data.sku,
        category:     data.category,
        customCategoryLabel: data.category === 'OTHER' ? (data.customCategoryLabel ?? '').trim() : undefined,
        unit:         data.unit,
        description:  data.description ?? '',
        reorderLevel: Number(data.reorderLevel ?? 0),
        unitCostKes:  Number(data.unitCostKes ?? 0),
      }).then(r => r.data),
    onSuccess: () => {
      invalidateItems();
      reset();
      setShowForm(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch(`/store/inventory/items/${id}`, payload).then(r => r.data),
    onSuccess: () => {
      invalidateItems();
      setEditing(null);
      reset();
      setShowForm(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/store/inventory/items/${id}`).then(r => r.data),
    onSuccess: () => {
      invalidateItems();
      setDeleteConfirm(null);
      setDeleteError(null);
    },
    onError: (err: any) => {
      setDeleteError(
        err?.response?.data?.message ?? 'Failed to remove item. It may still have stock on hand.',
      );
    },
  });

  const safeNum = (v: unknown) => {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };

  const resolveUnit = (data: FormData) =>
    data.unit === CUSTOM_UNIT ? (data.customUnit ?? '').trim() : data.unit;

  const onSubmit = (data: FormData) => {
    const unit = resolveUnit(data);
    if (editing) {
      updateMut.mutate({
        id: editing.id,
        payload: {
          name:         data.name.trim(),
          category:     data.category,
          customCategoryLabel: data.category === 'OTHER' ? (data.customCategoryLabel ?? '').trim() : '',
          unit,
          description:  data.description?.trim() ?? '',
          reorderLevel: safeNum(data.reorderLevel),
          unitCostKes:  safeNum(data.unitCostKes),
        },
      });
    } else {
      createMut.mutate({
        ...data,
        unit,
        reorderLevel: safeNum(data.reorderLevel),
        unitCostKes:  safeNum(data.unitCostKes),
      });
    }
  };

  const startEdit = (item: StoreItem) => {
    setEditing(item);
    createMut.reset();
    updateMut.reset();
    const isCustomUnit = !PRESET_UNIT_VALUES.has(item.unit);
    reset({
      name:         item.name,
      sku:          item.sku,
      category:     item.category,
      customCategoryLabel: item.customCategoryLabel ?? '',
      unit:         isCustomUnit ? CUSTOM_UNIT : item.unit,
      customUnit:   isCustomUnit ? item.unit : '',
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

  // Filter options include legacy FEED_SUPPLEMENT for existing items
  const filterCategories = [
    ...CATEGORIES,
    { value: 'FEED_SUPPLEMENT', label: 'Feed / Supplement (legacy)' },
  ];

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
            reset({ name: '', sku: '', category: '', customCategoryLabel: '', unit: '', customUnit: '', description: '', reorderLevel: 0, unitCostKes: 0 });
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
          {filterCategories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
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
                {/* Preserve legacy value so editing an existing FEED_SUPPLEMENT item doesn't blank the field */}
                {editing?.category === 'FEED_SUPPLEMENT' && (
                  <option value="FEED_SUPPLEMENT">Feed / Supplement (legacy)</option>
                )}
              </select>
              {selectedCategory === 'OTHER' && (
                <input
                  {...register('customCategoryLabel', {
                    required: selectedCategory === 'OTHER' ? 'Name this category' : false,
                    maxLength: { value: 50, message: 'Must be 50 characters or fewer' },
                  })}
                  placeholder="e.g. Charcoal, Disinfectant"
                  className="input mt-2"
                  autoFocus
                />
              )}
              {errors.customCategoryLabel && (
                <p className="text-[11px] text-red-600 mt-1">{errors.customCategoryLabel.message}</p>
              )}
            </Field>
            <Field label="Unit *" error={errors.unit?.message}>
              <select {...register('unit', { required: 'Required' })} className="input">
                <option value="">Select…</option>
                {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                <option value={CUSTOM_UNIT}>Other (custom)…</option>
              </select>
              {selectedUnit === CUSTOM_UNIT && (
                <input
                  {...register('customUnit', {
                    required: selectedUnit === CUSTOM_UNIT ? 'Enter a custom unit' : false,
                    maxLength: { value: 30, message: 'Must be 30 characters or fewer' },
                  })}
                  placeholder="e.g. Roll, Dozen, Pair"
                  className="input mt-2"
                  autoFocus
                />
              )}
              {errors.customUnit && (
                <p className="text-[11px] text-red-600 mt-1">{errors.customUnit.message}</p>
              )}
            </Field>
            <Field label="Reorder Level">
              <input type="number" step="any" {...register('reorderLevel')} className="input" />
              <p className="text-xs text-gray-400 mt-1">
                Negative values are allowed for items bought once or rarely — they'll never
                trigger a low-stock alert.
              </p>
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

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white dark:bg-dark-card rounded-2xl p-5 max-w-sm w-full shadow-xl space-y-3">
            <div className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              <h3 className="font-bold text-sm">Permanently Delete Item</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Are you sure you want to permanently delete <strong>{deleteConfirm.name}</strong> ({deleteConfirm.sku})?
              This action cannot be undone, but the item code <strong>{deleteConfirm.sku}</strong> will be freed up for reuse.
            </p>
            {Number(deleteConfirm.currentStock) > 0 && (
              <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-3 py-2 text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-amber-700 dark:text-amber-300">
                  This item still has <strong>{Number(deleteConfirm.currentStock)} {deleteConfirm.unit}</strong> in stock. You must issue out or adjust to zero before deleting.
                </p>
              </div>
            )}
            {deleteError && (
              <p className="text-xs text-red-600">{deleteError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  setDeleteError(null);
                  deleteMut.mutate(deleteConfirm.id);
                }}
                disabled={deleteMut.isPending || Number(deleteConfirm.currentStock) > 0}
                className="bg-red-600 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {deleteMut.isPending ? 'Deleting…' : 'Delete Permanently'}
              </button>
              <button
                onClick={() => { setDeleteConfirm(null); setDeleteError(null); deleteMut.reset(); }}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
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
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(i => {
                  const low = Number(i.currentStock) <= Number(i.reorderLevel);
                  return (
                    <tr
                      key={i.id}
                      className="border-t border-gray-100 dark:border-dark-border"
                    >
                      <td className="px-4 py-2 font-mono text-xs">{i.sku}</td>
                      <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-100">
                        {i.name}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{categoryDisplayLabel(i)}</td>
                      <td className={`px-4 py-2 text-right font-semibold ${low ? 'text-orange-600' : ''}`}>
                        {low && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                        {Number(i.currentStock)} {i.unit}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500">{Number(i.reorderLevel)}</td>
                      <td className="px-4 py-2 text-right">{fmtKES(i.unitCostKes)}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => startEdit(i)} className="text-brand-green hover:underline text-xs inline-flex items-center gap-1">
                            <Pencil className="w-3 h-3" /> Edit
                          </button>
                          <button
                            onClick={() => { setDeleteConfirm(i); setDeleteError(null); deleteMut.reset(); }}
                            className="text-red-500 hover:underline text-xs inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        </div>
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
