// src/pages/sales/ClientsPage.tsx
// Sales Person — manage their own client list

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api } from '../../lib/api/client';
import {
  Users, Plus, Search, Phone, Mail, MapPin, Edit2, Trash2,
  CheckCircle, X, ChevronDown, ChevronUp, AlertTriangle, User,
} from 'lucide-react';

const iCls = 'w-full border border-gray-700 rounded-xl px-4 py-2.5 text-sm bg-gray-900 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-green';
const lCls = 'block text-xs font-semibold text-gray-400 mb-1';

interface CustomerForm {
  name: string;
  phone: string;
  email: string;
  address: string;
  creditDays?: number;
}

function CustomerFormPanel({
  initial,
  onSave,
  onCancel,
  isSaving,
  error,
}: {
  initial?: any;
  onSave: (data: CustomerForm) => void;
  onCancel: () => void;
  isSaving: boolean;
  error?: string;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<CustomerForm>({
    defaultValues: {
      name: initial?.name ?? '',
      phone: initial?.phone ?? '',
      email: initial?.email ?? '',
      address: initial?.address ?? '',
    },
  });

  return (
    <form onSubmit={handleSubmit(onSave)} className="bg-gray-900 border border-gray-700 rounded-2xl p-5 space-y-4">
      <h3 className="text-sm font-bold text-white">{initial ? 'Edit Client' : 'New Client'}</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={lCls}>Full Name *</label>
          <input
            {...register('name', { required: 'Name is required' })}
            className={iCls}
            placeholder="e.g. Emali Supermarket"
          />
          {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <label className={lCls}>Phone Number</label>
          <input
            {...register('phone')}
            className={iCls}
            placeholder="e.g. 0712 345 678"
          />
        </div>
        <div>
          <label className={lCls}>Email Address</label>
          <input
            {...register('email')}
            type="email"
            className={iCls}
            placeholder="e.g. orders@business.co.ke"
          />
        </div>

        <div className="md:col-span-2">
          <label className={lCls}>Delivery Address <span className="font-normal text-gray-400">(optional)</span></label>
          <input
            {...register('address')}
            className={iCls}
            placeholder="e.g. Emali Town, Machakos County"
          />
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-xs bg-red-900/20 border border-red-800 rounded-xl px-3 py-2">{error}</p>
      )}

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-gray-700 rounded-xl py-2.5 text-sm font-semibold text-gray-400 hover:bg-gray-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="flex-1 bg-brand-green text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-60 hover:bg-green-700 transition-colors"
        >
          {isSaving ? 'Saving...' : initial ? 'Save Changes' : 'Add Client'}
        </button>
      </div>
    </form>
  );
}

function CustomerCard({
  customer,
  onEdit,
  onDelete,
}: {
  customer: any;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 transition-colors">
      {/* Header row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 p-4 text-left"
      >
        <div className="w-9 h-9 rounded-full bg-brand-green/20 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-brand-green">
            {customer.name.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm truncate">{customer.name}</p>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
            {customer.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" />{customer.phone}
              </span>
            )}
            {customer.creditDays > 0 && (
              <span className="bg-amber-900/40 text-amber-400 px-2 py-0.5 rounded-full font-semibold">
                {customer.creditDays}d credit
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 rounded-lg text-gray-500 hover:text-brand-green hover:bg-brand-green/10 transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
            className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <div className="text-gray-600 ml-1">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-800 px-4 pb-4 pt-3 space-y-2 text-sm text-gray-400">
          {customer.email && (
            <div className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 shrink-0" />
              <span>{customer.email}</span>
            </div>
          )}
          {customer.address && (
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span>{customer.address}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <User className="w-3.5 h-3.5 shrink-0" />
            <span>
              Payment terms: <strong className="text-gray-200">
                {customer.creditDays === 0 ? 'Cash on delivery' : `${customer.creditDays} days credit`}
              </strong>
            </span>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="border-t border-red-900/50 bg-red-900/20 px-4 py-3">
          <p className="text-xs text-red-400 mb-3 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Remove <strong>{customer.name}</strong> from your client list? Existing orders will not be affected.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 text-xs border border-gray-700 rounded-lg py-1.5 text-gray-400 hover:bg-gray-800"
            >
              Keep
            </button>
            <button
              onClick={() => { onDelete(); setConfirmDelete(false); }}
              className="flex-1 text-xs bg-red-600 text-white rounded-lg py-1.5 font-semibold hover:bg-red-700"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ClientsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [search, setSearch] = useState('');

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get('/sales/customers').then(r => r.data),
  });

  const create = useMutation({
    mutationFn: (data: CustomerForm) =>
      api.post('/sales/customers', {
        name: data.name,
        phone: data.phone || undefined,
        email: data.email || undefined,
        address: data.address || undefined,
        creditDays: Number(data.creditDays) || 0,
      }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setShowForm(false);
    },
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CustomerForm }) =>
      api.put(`/sales/customers/${id}`, {
        name: data.name,
        phone: data.phone || undefined,
        email: data.email || undefined,
        address: data.address || undefined,
        creditDays: Number(data.creditDays) || 0,
      }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setEditingCustomer(null);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/sales/customers/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });

  const filtered = (customers as any[]).filter((c: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.address?.toLowerCase().includes(q)
    );
  });

  const creditCount = (customers as any[]).filter((c: any) => c.creditDays > 0).length;

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-brand-green" /> Clients
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {(customers as any[]).length} client{(customers as any[]).length !== 1 ? 's' : ''}
            {creditCount > 0 && ` · ${creditCount} on credit terms`}
          </p>
        </div>
        <button
          onClick={() => { setShowForm(v => !v); setEditingCustomer(null); }}
          className="flex items-center gap-2 bg-brand-green text-white rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-green-700 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Client</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {/* Add form */}
      {showForm && !editingCustomer && (
        <div className="mb-5">
          <CustomerFormPanel
            onSave={data => create.mutate(data)}
            onCancel={() => setShowForm(false)}
            isSaving={create.isPending}
            error={(create.error as any)?.response?.data?.message}
          />
        </div>
      )}

      {/* Search */}
      {(customers as any[]).length > 3 && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, or location..."
            className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl h-16 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-gray-600" />
          </div>
          <p className="font-semibold text-gray-400">
            {search ? 'No clients match your search' : 'No clients yet'}
          </p>
          <p className="text-sm text-gray-600 mt-1">
            {search ? 'Try a different name or phone number' : 'Add your first client to get started'}
          </p>
          {!search && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 bg-brand-green text-white rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-green-700 inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add First Client
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {search && (
            <p className="text-xs text-gray-500 mb-1">
              {filtered.length} result{filtered.length !== 1 ? 's' : ''} for "{search}"
            </p>
          )}
          {filtered.map((customer: any) => (
            editingCustomer?.id === customer.id ? (
              <CustomerFormPanel
                key={customer.id}
                initial={customer}
                onSave={data => update.mutate({ id: customer.id, data })}
                onCancel={() => setEditingCustomer(null)}
                isSaving={update.isPending}
                error={(update.error as any)?.response?.data?.message}
              />
            ) : (
              <CustomerCard
                key={customer.id}
                customer={customer}
                onEdit={() => { setEditingCustomer(customer); setShowForm(false); }}
                onDelete={() => remove.mutate(customer.id)}
              />
            )
          ))}
        </div>
      )}

      {/* Success toast for delete */}
      {remove.isSuccess && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 text-white text-sm rounded-xl px-4 py-2.5 flex items-center gap-2 shadow-xl z-50">
          <CheckCircle className="w-4 h-4 text-brand-green" /> Client removed
        </div>
      )}
    </div>
  );
}
