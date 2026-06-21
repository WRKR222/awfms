// src/pages/owner/OwnerUsersPage.tsx
// Director manages user access: enable/disable users, view password-change log.
// OO Design: Director.manageAccessControl() — "monitor roles that changed passwords
// or manually disable a role's password and access in the case of personnel change"
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { Shield, Lock, Unlock, RefreshCw, CheckCircle, XCircle, Key } from 'lucide-react';
import dayjs from '../../lib/dayjs';

interface UserRecord {
  id: string; username: string; fullName: string; role: string; isActive: boolean;
  lastLoginAt?: string; email?: string;
}
interface ResetLog {
  id: string; targetUser: { username: string; fullName: string };
  adminUser?: { username: string }; createdAt: string; reason?: string;
}

const ROLE_COLORS: Record<string, string> = {
  MANAGER: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ATTENDANT: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  ACCOUNTANT: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  SALES: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  STORE: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  SECURITY1: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  SECURITY2: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  OWNER: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function OwnerUsersPage() {
  const qc = useQueryClient();
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [tab, setTab] = useState<'users' | 'log'>('users');

  const { data: users = [], isLoading } = useQuery<UserRecord[]>({
    queryKey: ['owner-users'],
    queryFn: () => api.get('/auth/users').then(r => r.data).catch(() => []),
  });

  const { data: resetLog = [] } = useQuery<ResetLog[]>({
    queryKey: ['password-reset-log'],
    queryFn: () => api.get('/auth/password-reset-log').then(r => r.data).catch(() => []),
    enabled: tab === 'log',
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/auth/users/${id}`, { isActive }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-users'] }),
  });

  const adminReset = useMutation({
    mutationFn: ({ userId, newPassword }: { userId: string; newPassword: string }) =>
      api.post(`/auth/admin-reset-password/${userId}`, { newPassword }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-users'] });
      setResetTarget(null);
      setNewPassword('');
    },
  });

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Shield className="w-5 h-5 text-brand-green" /> User Management
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Enable/disable access and manage passwords</p>
        </div>
        <div className="flex gap-2">
          {(['users', 'log'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-colors ${
                tab === t ? 'bg-brand-green text-white' : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-300'
              }`}>
              {t === 'log' ? 'Password Log' : 'Users'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'users' && (
        <div className="space-y-3">
          {isLoading && <p className="text-sm text-gray-400">Loading users...</p>}
          {users.map(u => (
            <div key={u.id} className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">{u.fullName}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                    {u.role}
                  </span>
                  {!u.isActive && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400">
                      DISABLED
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400">@{u.username}</p>
                {u.lastLoginAt && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Last login: {dayjs(u.lastLoginAt).format('D MMM YYYY HH:mm')}
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => { setResetTarget(u); setNewPassword(''); }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-dark-bg text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <Key className="w-3 h-3" /> Reset
                </button>
                <button
                  onClick={() => toggleActive.mutate({ id: u.id, isActive: !u.isActive })}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    u.isActive
                      ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100'
                      : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 hover:bg-green-100'
                  }`}
                >
                  {u.isActive ? <><Lock className="w-3 h-3" /> Disable</> : <><Unlock className="w-3 h-3" /> Enable</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'log' && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300">Password Reset History</h2>
          {resetLog.length === 0 && <p className="text-sm text-gray-400 italic">No password resets recorded.</p>}
          {resetLog.map(log => (
            <div key={log.id} className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border p-3 flex items-center gap-3">
              <RefreshCw className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 dark:text-gray-200">
                  <span className="font-medium">{log.targetUser.fullName}</span>
                  {log.adminUser && <span className="text-gray-400"> — reset by {log.adminUser.username}</span>}
                </p>
                <p className="text-xs text-gray-400">{dayjs(log.createdAt).format('D MMM YYYY HH:mm')}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Password reset modal */}
      {resetTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-dark-card rounded-2xl p-5 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-gray-800 dark:text-gray-100 mb-1">Reset Password</h3>
            <p className="text-sm text-gray-500 mb-4">Set a new password for <strong>{resetTarget.fullName}</strong></p>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green mb-3"
            />
            <div className="flex gap-2">
              <button onClick={() => setResetTarget(null)} className="flex-1 py-2 rounded-xl bg-gray-100 dark:bg-dark-bg text-sm font-semibold text-gray-600">Cancel</button>
              <button
                disabled={newPassword.length < 8 || adminReset.isPending}
                onClick={() => adminReset.mutate({ userId: resetTarget.id, newPassword })}
                className="flex-1 py-2 rounded-xl bg-brand-green text-white text-sm font-semibold disabled:opacity-50"
              >
                {adminReset.isPending ? 'Resetting...' : 'Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
