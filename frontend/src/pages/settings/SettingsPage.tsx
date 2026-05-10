import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Eye, EyeOff, KeyRound, ShieldCheck, Clock, User, CheckCircle,
  AlertCircle, Search, RotateCcw, ChevronDown, ChevronUp, Info, X, Globe,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import apiClient from '../../lib/api/client';
import { useTranslation } from 'react-i18next';
import { setLanguage, SUPPORTED_LANGUAGES, getCurrentLanguage, type LangCode } from '../../i18n';

// ── Schemas ────────────────────────────────────────────────────────────────────
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword:     z.string().min(8, 'New password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Confirm your new password'),
}).refine(d => d.newPassword === d.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});
type ChangePasswordForm = z.infer<typeof changePasswordSchema>;

const resetSchema = z.object({
  newPassword:     z.string().min(8, 'Must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Confirm the new password'),
}).refine(d => d.newPassword === d.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});
type ResetForm = z.infer<typeof resetSchema>;

// ── API helpers ────────────────────────────────────────────────────────────────
const changePassword     = (dto: { currentPassword: string; newPassword: string }) =>
  apiClient.post('/auth/change-password', dto);
const getPasswordResetLog = () =>
  apiClient.get('/auth/password-reset-log').then(r => r.data as Array<{
    id: string;
    resetType: 'ADMIN_RESET' | 'SELF_CHANGE';
    createdAt: string;
    admin: { fullName: string; username: string; role: string };
    targetUser: { fullName: string; username: string; role: string };
  }>);
const getUsers = () =>
  apiClient.get('/auth/users').then(r => r.data as Array<{
    id: string; fullName: string; username: string; email: string; role: string;
  }>);
const adminResetPassword = (userId: string, newPassword: string) =>
  apiClient.post(`/auth/admin-reset-password/${userId}`, { newPassword });

// ── Tooltip ────────────────────────────────────────────────────────────────────
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

// ── Password field ─────────────────────────────────────────────────────────────
function PasswordField({ label, id, register, error, placeholder }: {
  label: string; id: string; register: any; error?: string; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{label}</label>
      <div className="relative">
        <input
          {...register(id)}
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          className="w-full px-4 py-3 pr-11 border border-gray-300 dark:border-dark-border rounded-xl
            text-gray-900 dark:text-gray-100 bg-white dark:bg-dark-card
            placeholder-gray-400 dark:placeholder-gray-600
            focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-sm"
        />
        <button type="button" onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── Role badge ─────────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    OWNER:      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    MANAGER:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    SUPERVISOR: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
    ACCOUNTANT: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    ATTENDANT:  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[role] ?? 'bg-gray-100 text-gray-600'}`}>
      {role}
    </span>
  );
}

// ── Admin Reset Modal ──────────────────────────────────────────────────────────
function AdminResetModal({ targetUser, onClose }: {
  targetUser: { id: string; fullName: string; username: string; role: string };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [done, setDone] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<ResetForm>({
    resolver: zodResolver(resetSchema),
  });

  const reset = useMutation({
    mutationFn: (data: ResetForm) => adminResetPassword(targetUser.id, data.newPassword),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['password-reset-log'] });
      setDone(true);
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-dark-card w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
              <RotateCcw className="w-4 h-4 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Reset Password</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">Admin override</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-5">
          {done ? (
            <div className="text-center py-4 space-y-3">
              <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Password Reset Successfully</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                <span className="font-semibold">{targetUser.fullName}</span>'s password has been updated.
                They will be signed out of all active sessions.
              </p>
              <button onClick={onClose}
                className="mt-2 px-6 py-2.5 bg-brand-green text-white rounded-xl font-semibold text-sm hover:bg-green-600 transition-colors">
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit(d => reset.mutate(d))} className="space-y-4">
              {/* Target user info */}
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800 rounded-xl p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-orange-600 dark:text-orange-400">
                    {targetUser.fullName.charAt(0)}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{targetUser.fullName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-400 dark:text-gray-500">@{targetUser.username}</span>
                    <RoleBadge role={targetUser.role} />
                  </div>
                </div>
              </div>

              <Tooltip tip="The user will be forced to use this new password on their next login. All active sessions will be terminated.">
                <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl px-3 py-2 cursor-default w-full">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  This will sign the user out of all active sessions.
                  <Info className="w-3 h-3 ml-auto opacity-50" />
                </div>
              </Tooltip>

              <PasswordField
                label="New Password" id="newPassword"
                register={register} error={errors.newPassword?.message}
                placeholder="Min 8 characters"
              />
              <PasswordField
                label="Confirm New Password" id="confirmPassword"
                register={register} error={errors.confirmPassword?.message}
                placeholder="Repeat new password"
              />

              {reset.isError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {(reset.error as any)?.response?.data?.message ?? 'Reset failed. Please try again.'}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={onClose}
                  className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-dark-bg text-gray-600 dark:text-gray-400
                    rounded-xl font-semibold text-sm hover:bg-gray-200 dark:hover:bg-dark-border transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={reset.isPending}
                  className="flex-1 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white
                    rounded-xl font-semibold text-sm disabled:opacity-60 transition-colors
                    flex items-center justify-center gap-2">
                  {reset.isPending ? 'Resetting...' : <><RotateCcw className="w-4 h-4" /> Reset Password</>}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Admin Reset Section ────────────────────────────────────────────────────────
function AdminResetSection() {
  const { user: currentUser } = useAuthStore();
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [expanded, setExpanded] = useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users-list'],
    queryFn: getUsers,
    staleTime: 5 * 60_000,
  });

  // Exclude self from the list
  const filtered = users
    .filter(u => u.id !== currentUser?.id)
    .filter(u =>
      !search ||
      u.fullName.toLowerCase().includes(search.toLowerCase()) ||
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.role.toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-2xl overflow-hidden">
      {/* Header — clickable to expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 text-left hover:bg-gray-50 dark:hover:bg-dark-bg transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center">
            <RotateCcw className="w-4 h-4 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Reset User Password</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Override any staff member's password
            </p>
          </div>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-gray-400" />
          : <ChevronDown className="w-4 h-4 text-gray-400" />
        }
      </button>

      {expanded && (
        <div className="px-6 pb-6 space-y-4 border-t border-gray-100 dark:border-dark-border pt-4">
          {/* Info banner */}
          <Tooltip tip="Use this when a staff member is locked out and cannot reset their own password. All active sessions are terminated on reset.">
            <div className="flex items-start gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-3 cursor-default w-full">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>Use this to reset a staff member's password when they are locked out. The user will be signed out of all active sessions immediately.</span>
            </div>
          </Tooltip>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, username or role..."
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-dark-border rounded-xl text-sm
                bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100
                focus:outline-none focus:ring-2 focus:ring-brand-green"
            />
          </div>

          {/* User list */}
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-100 dark:bg-dark-bg rounded-xl animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-400 dark:text-gray-500">
              {search ? 'No users match your search' : 'No other users found'}
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {filtered.map(u => (
                <div
                  key={u.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-dark-border
                    bg-gray-50 dark:bg-dark-bg hover:bg-white dark:hover:bg-dark-card
                    transition-colors"
                >
                  <div className="w-9 h-9 rounded-xl bg-brand-green/10 dark:bg-brand-green/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-brand-green">{u.fullName.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{u.fullName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400 dark:text-gray-500">@{u.username}</span>
                      <RoleBadge role={u.role} />
                    </div>
                  </div>
                  <Tooltip tip={`Reset ${u.fullName}'s password`}>
                    <button
                      onClick={() => setSelectedUser(u)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 dark:bg-orange-900/20
                        text-orange-600 dark:text-orange-400 border border-orange-100 dark:border-orange-800
                        rounded-lg text-xs font-semibold hover:bg-orange-100 dark:hover:bg-orange-900/40
                        transition-colors active:scale-[0.97] flex-shrink-0"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset
                    </button>
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedUser && (
        <AdminResetModal
          targetUser={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
}

// ── Main Settings page ─────────────────────────────────────────────────────────
export function SettingsPage() {
  const { user } = useAuthStore();
  const { t } = useTranslation();
  const isAdmin = user?.role === 'OWNER' || user?.role === 'MANAGER';
  // FIX: OWNER has dedicated User Management page — don't show admin reset section here.
  // MANAGER still sees it since they have no separate user management page.
  const showAdminSection = user?.role === 'MANAGER';
  const [successMsg, setSuccessMsg] = useState('');
  const [langSaved, setLangSaved] = useState(false);
  const [currentLang, setCurrentLang] = useState<LangCode>(getCurrentLanguage());

  const handleLanguageChange = (code: LangCode) => {
    setLanguage(code);
    setCurrentLang(code);
    setLangSaved(true);
    setTimeout(() => setLangSaved(false), 3000);
  };

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ChangePasswordForm>({
    resolver: zodResolver(changePasswordSchema),
  });

  const changePwMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      reset();
      setSuccessMsg('Password changed successfully.');
      setTimeout(() => setSuccessMsg(''), 5000);
    },
  });

  const logQuery = useQuery({
    queryKey: ['password-reset-log'],
    queryFn: getPasswordResetLog,
    enabled: isAdmin,
  });

  const onSubmit = (data: ChangePasswordForm) => {
    changePwMutation.mutate({ currentPassword: data.currentPassword, newPassword: data.newPassword });
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('en-KE', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your account preferences</p>
      </div>

      {/* Profile card */}
      <div className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-brand-green/10 flex items-center justify-center flex-shrink-0">
            <span className="text-xl font-bold text-brand-green">{user?.fullName?.charAt(0) ?? '?'}</span>
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-gray-100">{user?.fullName}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">@{user?.username}</p>
            <div className="mt-1"><RoleBadge role={user?.role ?? ''} /></div>
          </div>
        </div>
      </div>

      {/* Language / Lugha */}
      <div className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-brand-teal/10 flex items-center justify-center">
            <Globe className="w-4 h-4 text-brand-teal" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t('settings.language')}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.languageSubtitle')}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {SUPPORTED_LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                currentLang === lang.code
                  ? 'border-brand-teal bg-brand-teal/10 text-brand-teal dark:text-brand-teal'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <span className="text-base">{lang.code === 'en' ? '🇬🇧' : '🇰🇪'}</span>
              <span>{lang.nativeLabel}</span>
              {currentLang === lang.code && (
                <CheckCircle className="w-3.5 h-3.5 ml-0.5" />
              )}
            </button>
          ))}
        </div>

        {langSaved && (
          <p className="mt-3 text-xs text-brand-teal flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" />
            {t('settings.languageSaved')}
          </p>
        )}
      </div>

      {/* Change Password */}
      <div className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl bg-brand-green/10 flex items-center justify-center">
            <KeyRound className="w-4 h-4 text-brand-green" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Change Password</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Update your account password</p>
          </div>
        </div>

        {successMsg && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-green-700 dark:text-green-400 text-sm">
            <CheckCircle className="w-4 h-4 flex-shrink-0" /> {successMsg}
          </div>
        )}
        {changePwMutation.isError && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {(changePwMutation.error as any)?.response?.data?.message ?? 'Incorrect current password'}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <PasswordField label="Current Password" id="currentPassword" register={register}
            error={errors.currentPassword?.message} placeholder="Enter current password" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PasswordField label="New Password" id="newPassword" register={register}
              error={errors.newPassword?.message} placeholder="Min 8 characters" />
            <PasswordField label="Confirm New Password" id="confirmPassword" register={register}
              error={errors.confirmPassword?.message} placeholder="Repeat new password" />
          </div>
          <div className="pt-2">
            <button type="submit" disabled={changePwMutation.isPending}
              className="px-6 py-2.5 bg-brand-green hover:bg-green-600 disabled:opacity-50
                text-white font-medium text-sm rounded-xl transition-colors flex items-center gap-2">
              {changePwMutation.isPending ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>

      {/* Admin-only section */}
      {isAdmin && (
        <>
          {/* OWNER: link to dedicated User Management page (avoids duplication) */}
          {user?.role === 'OWNER' && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-2xl p-5 flex items-center justify-between">
              <div>
                <p className="font-semibold text-blue-800 dark:text-blue-300 text-sm">User &amp; Access Management</p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">Enable/disable roles, reset passwords and view audit logs</p>
              </div>
              <a href="/owner/users" className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-white dark:bg-dark-card border border-blue-200 dark:border-blue-700 px-3 py-2 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
                Open User Management →
              </a>
            </div>
          )}
          {/* MANAGER: admin reset section shown here */}
          {showAdminSection && <AdminResetSection />}

          {/* Password Reset Log */}
          <div className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Password Reset Log</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">All password changes across the system</p>
              </div>
            </div>

            {logQuery.isLoading && (
              <div className="py-8 text-center text-sm text-gray-400">Loading log...</div>
            )}
            {logQuery.data?.length === 0 && (
              <div className="py-8 text-center text-sm text-gray-400">No password changes recorded yet.</div>
            )}
            {logQuery.data && logQuery.data.length > 0 && (
              <div className="space-y-3">
                {logQuery.data.map(entry => (
                  <div key={entry.id}
                    className="flex items-start gap-3 p-4 rounded-xl bg-gray-50 dark:bg-dark-bg border border-gray-100 dark:border-dark-border">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      entry.resetType === 'ADMIN_RESET'
                        ? 'bg-orange-100 dark:bg-orange-900/20'
                        : 'bg-green-100 dark:bg-green-900/20'
                    }`}>
                      {entry.resetType === 'ADMIN_RESET'
                        ? <RotateCcw className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                        : <User className="w-4 h-4 text-green-600 dark:text-green-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {entry.resetType === 'ADMIN_RESET' ? (
                          <p className="text-sm text-gray-700 dark:text-gray-300">
                            <span className="font-semibold">{entry.admin.fullName}</span>
                            {' '}reset password for{' '}
                            <span className="font-semibold">{entry.targetUser.fullName}</span>
                          </p>
                        ) : (
                          <p className="text-sm text-gray-700 dark:text-gray-300">
                            <span className="font-semibold">{entry.targetUser.fullName}</span>
                            {' '}changed their own password
                          </p>
                        )}
                        <RoleBadge role={entry.targetUser.role} />
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-xs text-gray-400 dark:text-gray-500">
                        <Clock className="w-3 h-3" />
                        {formatDate(entry.createdAt)}
                      </div>
                    </div>
                    <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                      entry.resetType === 'ADMIN_RESET'
                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    }`}>
                      {entry.resetType === 'ADMIN_RESET' ? 'Admin Reset' : 'Self Changed'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
