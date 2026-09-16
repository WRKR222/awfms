// frontend/src/pages/store/StoreHRPage.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Fixes: GAP-01 (missing HR page), GAP-03 (employee record CRUD),
//        GAP-12 (missing employee fields)
//
// REQUIRES: Run store_role_improvements.sql migration first (adds
//           employee_number, address, work_phone, mobile_phone columns)
//           and update Prisma schema + FarmHRService DTOs accordingly.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Pencil, Users, HardHat, Download } from 'lucide-react';
import dayjs from '../../lib/dayjs';
import { api } from '../../lib/api/client';

// ─── Types ────────────────────────────────────────────────────────────────
type Employee = {
  id: string;
  fullName: string;
  employeeNumber?: string | null;
  nationalId?: string | null;
  address?: string | null;
  workPhone?: string | null;
  mobilePhone?: string | null;
  phone?: string | null;   // legacy field
  email?: string | null;
  role: string;
  assignment?: string | null;
  status: string;
  hireDate: string;
  terminationReason?: string | null;
  nextOfKinName?: string | null;
  nextOfKinPhone?: string | null;
  nextOfKinRelation?: string | null;
  notes?: string | null;
};

type ConstructionRecord = {
  id: string;
  title: string;
  constructionType: string;
  location: string;
  startDate: string;
  endDate?: string | null;
  contractorName?: string | null;
  contractorPhone?: string | null;
  budgetKes: number;
  actualCostKes: number;
  status: string;
  description?: string | null;
};

type EmpFormData = Omit<Employee, 'id' | 'status' | 'hireDate'> & {
  hireDate: string;
  status?: string;
};

type ConstrFormData = Omit<ConstructionRecord, 'id' | 'budgetKes' | 'actualCostKes'> & {
  budgetKes?: number;
  actualCostKes?: number;
};

// ─── Component ────────────────────────────────────────────────────────────
export default function StoreHRPage() {
  const [tab, setTab] = useState<'employees' | 'construction'>('employees');

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <header>
        <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100">HR Records</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Manage farm employee records and construction project records.
        </p>
      </header>

      {/* Tab bar */}
      <div className="flex gap-1 bg-white dark:bg-dark-card rounded-2xl p-1 border border-gray-100 dark:border-dark-border w-fit">
        {([
          { key: 'employees', label: 'Farm Employees', icon: Users },
          { key: 'construction', label: 'Construction', icon: HardHat },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              tab === key ? 'bg-brand-green text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'employees'   && <EmployeesTab />}
      {tab === 'construction' && <ConstructionTab />}
    </div>
  );
}

// ─── Employees Tab ────────────────────────────────────────────────────────
function EmployeesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [statusFilter, setStatusFilter] = useState('ACTIVE');

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['farm-employees', statusFilter],
    queryFn: async () => (await api.get('/farm-hr/employees', { params: statusFilter ? { status: statusFilter } : {} })).data as Employee[],
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<EmpFormData>();
  const watchedStatus = watch('status');

  const createMut = useMutation({
    mutationFn: (data: EmpFormData) => api.post('/farm-hr/employees', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['farm-employees'] }); reset(); setShowForm(false); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EmpFormData> }) =>
      api.patch(`/farm-hr/employees/${id}`, data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['farm-employees'] });
      setEditing(null);
      setShowForm(false);
      // FIX: terminating an employee while viewing a filtered list (e.g.
      // "Active") made that record vanish immediately — the status no
      // longer matched the filter. Switch to "All" so the record Store just
      // changed stays visible instead of disappearing right after the edit.
      if (res.data?.status === 'TERMINATED' && statusFilter && statusFilter !== 'TERMINATED') {
        setStatusFilter('');
      }
    },
  });

  const startEdit = (emp: Employee) => {
    setEditing(emp);
    reset({
      fullName: emp.fullName, employeeNumber: emp.employeeNumber ?? '',
      nationalId: emp.nationalId ?? '', address: emp.address ?? '',
      workPhone: emp.workPhone ?? '', mobilePhone: emp.mobilePhone ?? emp.phone ?? '',
      email: emp.email ?? '', role: emp.role, assignment: emp.assignment ?? '',
      hireDate: dayjs(emp.hireDate).format('YYYY-MM-DD'), status: emp.status,
      terminationReason: emp.terminationReason ?? '',
      nextOfKinName: emp.nextOfKinName ?? '', nextOfKinPhone: emp.nextOfKinPhone ?? '',
      nextOfKinRelation: emp.nextOfKinRelation ?? '', notes: emp.notes ?? '',
    });
    setShowForm(true);
  };

  const onSubmit = (data: EmpFormData) => {
    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  };

  // CSV export
  const exportCSV = () => {
    const headers = ['Employee Number', 'Full Name', 'National ID', 'Address', 'Work Phone', 'Mobile Phone', 'Email', 'Role', 'Assigned To', 'Hire Date', 'Status', 'Termination Reason', 'Next of Kin', 'Next of Kin Phone'];
    const rows = list.map(e => [
      e.employeeNumber ?? '', e.fullName, e.nationalId ?? '', e.address ?? '',
      e.workPhone ?? '', e.mobilePhone ?? e.phone ?? '', e.email ?? '',
      e.role, e.assignment ?? '', dayjs(e.hireDate).format('YYYY-MM-DD'), e.status,
      e.terminationReason ?? '',
      e.nextOfKinName ?? '', e.nextOfKinPhone ?? '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `farm_employees_${dayjs().format('YYYYMMDD')}.csv`; a.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => { setEditing(null); reset({}); setShowForm(v => !v); }}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
          <Plus className="w-4 h-4" /> {showForm && !editing ? 'Cancel' : 'Add Employee'}
        </button>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="rounded-xl text-sm border border-gray-200 dark:border-dark-border bg-white dark:bg-gray-800 px-3 py-2">
          <option value="">All</option>
          <option value="ACTIVE">Active</option>
          <option value="ON_LEAVE">On Leave</option>
          <option value="TERMINATED">Terminated</option>
        </select>
        <button onClick={exportCSV}
          className="ml-auto flex items-center gap-2 px-3 py-2 rounded-xl text-sm border border-gray-200 dark:border-dark-border text-gray-600 hover:bg-gray-50">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)}
          className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-200">
            {editing ? `Edit Employee — ${editing.fullName}` : 'Add New Employee'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <Fld label="Full Name *" err={errors.fullName?.message}>
              <input {...register('fullName', { required: 'Required' })} className="input" />
            </Fld>
            <Fld label="Employee Number">
              <input {...register('employeeNumber')} className="input" placeholder="e.g. EMP-001" />
            </Fld>
            <Fld label="National ID">
              <input {...register('nationalId')} className="input" />
            </Fld>
            <Fld label="Address">
              <input {...register('address')} className="input" />
            </Fld>
            <Fld label="Work Phone">
              <input {...register('workPhone')} className="input" />
            </Fld>
            <Fld label="Mobile Phone">
              <input {...register('mobilePhone')} className="input" />
            </Fld>
            <Fld label="Email">
              <input type="email" {...register('email')} className="input" />
            </Fld>
            <Fld label="Role / Designation *" err={errors.role?.message}>
              <input {...register('role', { required: 'Required' })} className="input" placeholder="e.g. Farm Attendant" />
            </Fld>
            <Fld label="Assigned To">
              <input {...register('assignment')} className="input" placeholder="e.g. Block 1, Brooder" />
            </Fld>
            <Fld label="Hire Date *" err={errors.hireDate?.message}>
              <input type="date" {...register('hireDate', { required: 'Required' })} className="input" />
            </Fld>
            {editing && (
              <Fld label="Status">
                <select {...register('status')} className="input">
                  <option value="ACTIVE">Active</option>
                  <option value="ON_LEAVE">On Leave</option>
                  <option value="TERMINATED">Terminated</option>
                </select>
              </Fld>
            )}
            {editing && watchedStatus === 'TERMINATED' && (
              <div className="md:col-span-2 lg:col-span-3">
                <Fld label="Reason for Termination *" err={errors.terminationReason?.message}>
                  <textarea
                    rows={2}
                    {...register('terminationReason', { required: 'Required when status is Terminated' })}
                    className="input"
                    placeholder="e.g. Resigned, contract ended, misconduct..."
                  />
                </Fld>
              </div>
            )}
            <Fld label="Next of Kin Name">
              <input {...register('nextOfKinName')} className="input" />
            </Fld>
            <Fld label="Next of Kin Phone">
              <input {...register('nextOfKinPhone')} className="input" />
            </Fld>
            <Fld label="Next of Kin Relation">
              <input {...register('nextOfKinRelation')} className="input" placeholder="e.g. Spouse, Parent" />
            </Fld>
            <div className="md:col-span-2 lg:col-span-3">
              <Fld label="Notes">
                <textarea rows={2} {...register('notes')} className="input" />
              </Fld>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={createMut.isPending || updateMut.isPending}
              className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
              {editing ? 'Save Changes' : 'Add Employee'}
            </button>
            {editing && (
              <button type="button" onClick={() => { setEditing(null); setShowForm(false); }}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-dark-border">
                Cancel
              </button>
            )}
          </div>
          {(createMut.isError || updateMut.isError) && <p className="text-xs text-red-600">Failed to save. Check required fields.</p>}
        </form>
      )}

      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        {isLoading ? <div className="p-6 text-center text-sm text-gray-500">Loading employees…</div>
        : list.length === 0 ? <div className="p-6 text-center text-sm text-gray-500">No employee records found.</div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Emp No.</th>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Role</th>
                  <th className="text-left px-4 py-2">Assigned To</th>
                  <th className="text-left px-4 py-2">Mobile</th>
                  <th className="text-left px-4 py-2">Hired</th>
                  <th className="text-center px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(e => (
                  <tr key={e.id} className="border-t border-gray-100 dark:border-dark-border hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{e.employeeNumber ?? '—'}</td>
                    <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-100">{e.fullName}</td>
                    <td className="px-4 py-2 text-gray-600">{e.role}</td>
                    <td className="px-4 py-2 text-gray-500">{e.assignment ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{e.mobilePhone ?? e.phone ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{dayjs(e.hireDate).format('DD/MM/YYYY')}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        e.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' :
                        e.status === 'TERMINATED' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-600'
                      }`}>{e.status}</span>
                      {e.status === 'TERMINATED' && e.terminationReason && (
                        <p className="text-[11px] text-gray-400 mt-1 max-w-[14rem] mx-auto truncate" title={e.terminationReason}>
                          {e.terminationReason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => startEdit(e)} className="text-brand-green hover:underline text-xs inline-flex items-center gap-1">
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <style>{`.input{width:100%;border-radius:.75rem;border:1px solid rgb(229 231 235);background:white;font-size:.875rem;padding:.5rem .75rem}.dark .input{background:rgb(31 41 55);border-color:rgb(55 65 81);color:white}`}</style>
    </div>
  );
}

// ─── Construction Tab ─────────────────────────────────────────────────────
function ConstructionTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ConstructionRecord | null>(null);

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['construction-records'],
    queryFn: async () => (await api.get('/farm-hr/construction')).data as ConstructionRecord[],
  });

  const { register, handleSubmit, reset } = useForm<ConstrFormData>();

  const createMut = useMutation({
    mutationFn: (data: ConstrFormData) => api.post('/farm-hr/construction', {
      ...data,
      budgetKes: Number(data.budgetKes ?? 0),
      actualCostKes: Number(data.actualCostKes ?? 0),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['construction-records'] }); reset(); setShowForm(false); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ConstrFormData> }) =>
      api.patch(`/farm-hr/construction/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['construction-records'] }); setEditing(null); setShowForm(false); },
  });

  const startEdit = (r: ConstructionRecord) => {
    setEditing(r);
    reset({
      title: r.title, constructionType: r.constructionType, location: r.location,
      startDate: dayjs(r.startDate).format('YYYY-MM-DD'),
      endDate: r.endDate ? dayjs(r.endDate).format('YYYY-MM-DD') : '',
      contractorName: r.contractorName ?? '', contractorPhone: r.contractorPhone ?? '',
      budgetKes: r.budgetKes, actualCostKes: r.actualCostKes, status: r.status,
      description: r.description ?? '',
    });
    setShowForm(true);
  };

  const onSubmit = (data: ConstrFormData) => {
    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => { setEditing(null); reset({}); setShowForm(v => !v); }}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold">
          <Plus className="w-4 h-4" /> {showForm && !editing ? 'Cancel' : 'Add Construction Record'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)}
          className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border space-y-3">
          <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-200">
            {editing ? `Edit — ${editing.title}` : 'New Construction Record'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Fld label="Title *"><input {...register('title', { required: true })} className="input" /></Fld>
            <Fld label="Type">
              <select {...register('constructionType')} className="input">
                <option value="BLOCK">Block</option>
                <option value="ROAD">Road</option>
                <option value="FENCE">Fence</option>
                <option value="RENOVATION">Renovation</option>
                <option value="OTHER">Other</option>
              </select>
            </Fld>
            <Fld label="Location"><input {...register('location', { required: true })} className="input" placeholder="e.g. Block 2" /></Fld>
            <Fld label="Status">
              <select {...register('status')} className="input">
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="ON_HOLD">On Hold</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </Fld>
            <Fld label="Start Date"><input type="date" {...register('startDate', { required: true })} className="input" /></Fld>
            <Fld label="End Date"><input type="date" {...register('endDate')} className="input" /></Fld>
            <Fld label="Contractor Name"><input {...register('contractorName')} className="input" /></Fld>
            <Fld label="Contractor Phone"><input {...register('contractorPhone')} className="input" /></Fld>
            <Fld label="Budget (KES)"><input type="number" step="any" {...register('budgetKes')} className="input" /></Fld>
            <Fld label="Actual Cost (KES)"><input type="number" step="any" {...register('actualCostKes')} className="input" /></Fld>
            <div className="md:col-span-2">
              <Fld label="Description"><textarea rows={2} {...register('description')} className="input" /></Fld>
            </div>
          </div>
          <button type="submit" disabled={createMut.isPending || updateMut.isPending}
            className="bg-brand-green text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
            {editing ? 'Save Changes' : 'Create Record'}
          </button>
        </form>
      )}

      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border overflow-hidden">
        {isLoading ? <div className="p-6 text-center text-sm text-gray-500">Loading…</div>
        : list.length === 0 ? <div className="p-6 text-center text-sm text-gray-500">No construction records.</div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Title</th>
                  <th className="text-left px-4 py-2">Location</th>
                  <th className="text-left px-4 py-2">Contractor</th>
                  <th className="text-left px-4 py-2">Start</th>
                  <th className="text-right px-4 py-2">Budget</th>
                  <th className="text-center px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id} className="border-t border-gray-100 dark:border-dark-border">
                    <td className="px-4 py-2 font-medium">{r.title}</td>
                    <td className="px-4 py-2 text-gray-600">{r.location}</td>
                    <td className="px-4 py-2 text-gray-600">{r.contractorName ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{dayjs(r.startDate).format('DD/MM/YYYY')}</td>
                    <td className="px-4 py-2 text-right">KES {Number(r.budgetKes).toLocaleString()}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${r.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : r.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'}`}>
                        {r.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => startEdit(r)} className="text-brand-green hover:underline text-xs inline-flex items-center gap-1">
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <style>{`.input{width:100%;border-radius:.75rem;border:1px solid rgb(229 231 235);background:white;font-size:.875rem;padding:.5rem .75rem}.dark .input{background:rgb(31 41 55);border-color:rgb(55 65 81);color:white}`}</style>
    </div>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────
function Fld({ label, err, children }: { label: string; err?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      {children}
      {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
    </div>
  );
}
