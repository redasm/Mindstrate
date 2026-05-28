'use client';

import { useState } from 'react';
import type { ApiKey } from '@mindstrate/protocol';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { useTranslations } from '@/lib/i18n/hooks';

type Role = 'admin' | 'member';

interface Props {
  initialUsers: ApiKey[];
  knownProjects: string[];
}

interface NewUserForm {
  name: string;
  projects: Set<string>;
  extraProjects: string;
}

const blankNewUser = (): NewUserForm => ({
  name: '',
  projects: new Set(),
  extraProjects: '',
});

export function UsersClient({ initialUsers, knownProjects }: Props) {
  const t = useTranslations();
  const [users, setUsers] = useState<ApiKey[]>(initialUsers);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<NewUserForm>(blankNewUser());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [createdKey, setCreatedKey] = useState<{ user: ApiKey } | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState('');

  const toggleProject = (p: string) =>
    setForm((f) => {
      const next = new Set(f.projects);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return { ...f, projects: next };
    });

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) {
      setError(t.users.nameRequired);
      return;
    }
    const projects = [
      ...form.projects,
      ...form.extraProjects.split(',').map((p) => p.trim()).filter(Boolean),
    ];
    if (projects.length === 0) {
      setError(t.users.membersNeedProject);
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), projects }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Create failed');
      setUsers((cur) => [data, ...cur]);
      setCreatedKey({ user: data });
      setShowCreate(false);
      setForm(blankNewUser());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleEnabled = async (user: ApiKey) => {
    setBusyId(user.id);
    setGlobalError('');
    try {
      const resp = await fetch(`/api/admin/keys/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !!user.revokedAt }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Toggle failed');
      setUsers((cur) => cur.map((u) => (u.id === user.id
        ? { ...u, revokedAt: user.revokedAt ? undefined : new Date().toISOString() }
        : u)));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Toggle failed');
    } finally {
      setBusyId(null);
    }
  };

  const demoteToMember = async (user: ApiKey) => {
    if (!confirm(t.users.demoteConfirm.replace('{NAME}', user.name))) return;
    setBusyId(user.id);
    setGlobalError('');
    try {
      const resp = await fetch(`/api/admin/keys/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'member' }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Demote failed');
      setUsers((cur) => cur.map((u) => (u.id === user.id ? { ...u, role: 'member' as Role } : u)));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Demote failed');
    } finally {
      setBusyId(null);
    }
  };

  const regenerate = async (user: ApiKey) => {
    if (!confirm(t.users.regenConfirm.replace('{NAME}', user.name))) return;
    setBusyId(user.id);
    setGlobalError('');
    try {
      const resp = await fetch(`/api/admin/keys/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate: true }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Regenerate failed');
      if (data.newKey) {
        setUsers((cur) => cur.map((u) => (u.id === user.id ? { ...u, key: data.newKey } : u)));
        setRevealedId(user.id);
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Regenerate failed');
    } finally {
      setBusyId(null);
    }
  };

  const deleteUser = async (user: ApiKey) => {
    if (!confirm(t.users.deleteConfirm.replace('{NAME}', user.name))) return;
    setBusyId(user.id);
    setGlobalError('');
    try {
      const resp = await fetch(`/api/admin/keys/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Delete failed');
      setUsers((cur) => cur.filter((u) => u.id !== user.id));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-5">
      <div className="flex items-end justify-between mb-6 anim-in d1 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-surface-900 mb-1">{t.users.title}</h1>
          <p className="text-sm text-surface-500 font-medium">{t.users.description}</p>
        </div>
        <button
          type="button"
          onClick={() => { setShowCreate(true); setError(''); }}
          className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Icon icon="lucide:user-plus" className="text-sm" />
          {t.users.addUser}
        </button>
      </div>

      {globalError && (
        <div className="mb-5 flex items-center gap-2.5 px-3.5 py-2.5 bg-red-50 border border-red-100 rounded-xl">
          <Icon icon="lucide:alert-circle" className="text-red-500 text-base" />
          <span className="text-sm font-medium text-red-700">{globalError}</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-surface-200 overflow-hidden anim-in d2">
        <table className="w-full text-sm">
          <thead className="bg-surface-50 text-left text-xs font-semibold text-surface-500 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">{t.users.user}</th>
              <th className="px-4 py-3">{t.users.role}</th>
              <th className="px-4 py-3">{t.users.projects}</th>
              <th className="px-4 py-3">{t.users.key}</th>
              <th className="px-4 py-3">{t.users.status}</th>
              <th className="px-4 py-3 text-right">{t.users.actions}</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-surface-400">{t.users.noUsers}</td>
              </tr>
            )}
            {users.map((u) => {
              const isAdmin = u.role === 'admin';
              const revealed = revealedId === u.id;
              const disabled = !!u.revokedAt;
              return (
                <tr key={u.id} className="border-t border-surface-100 align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full user-avatar flex items-center justify-center">
                        {u.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-surface-900">{u.name}</div>
                        <div className="text-xs text-surface-400 font-mono">{u.id.slice(0, 12)}…</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`role-pill ${isAdmin ? 'role-admin' : 'role-member'}`}>
                      {isAdmin ? t.auth.role.admin : t.auth.role.member}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {u.projects.slice(0, 4).map((p) => (
                        <span key={p} className="project-tag">{p}</span>
                      ))}
                      {u.projects.length > 4 && (
                        <span className="text-xs text-surface-400">+{u.projects.length - 4}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-surface-600">
                        {revealed ? u.key : '•'.repeat(12)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRevealedId(revealed ? null : u.id)}
                        className="text-xs text-brand-600 font-semibold hover:underline"
                      >
                        {revealed ? t.users.hide : t.users.reveal}
                      </button>
                      {revealed && (
                        <button
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(u.key)}
                          className="text-xs text-brand-600 font-semibold hover:underline"
                        >
                          {t.users.copy}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {disabled ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full bg-surface-100 text-surface-500">
                        {t.users.statusDisabled}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
                        {t.users.statusActive}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => demoteToMember(u)}
                        disabled={busyId === u.id}
                        className="text-xs text-amber-600 font-semibold hover:underline disabled:opacity-40"
                      >
                        {t.users.demote}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleEnabled(u)}
                      disabled={busyId === u.id}
                      className="text-xs text-brand-600 font-semibold hover:underline disabled:opacity-40"
                    >
                      {disabled ? t.users.enable : t.users.disable}
                    </button>
                    <button
                      type="button"
                      onClick={() => regenerate(u)}
                      disabled={busyId === u.id}
                      className="text-xs text-brand-600 font-semibold hover:underline disabled:opacity-40"
                    >
                      {t.users.regenerate}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteUser(u)}
                      disabled={busyId === u.id}
                      className="text-xs text-red-600 font-semibold hover:underline disabled:opacity-40"
                    >
                      {t.users.delete}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} width={520}>
        <form onSubmit={submitCreate} className="flex flex-col">
          <div className="px-5 py-4 border-b border-surface-100 flex items-center justify-between">
            <h2 className="text-base font-bold text-surface-900">{t.users.addUserTitle}</h2>
            <button type="button" onClick={() => setShowCreate(false)} className="text-surface-400 hover:text-surface-600">
              <Icon icon="lucide:x" className="text-lg" />
            </button>
          </div>
          <div className="p-5 space-y-4 overflow-y-auto">
            {error && (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
                <Icon icon="lucide:alert-circle" className="text-base" />
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-surface-700 mb-1.5">{t.users.nameLabel}</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t.users.namePlaceholder}
                className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
                autoFocus
              />
            </div>
            <div className="flex items-start gap-2 px-3 py-2.5 bg-brand-50 border border-brand-100 rounded-lg text-xs text-brand-800">
              <Icon icon="lucide:info" className="text-sm mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold">{t.users.bannerHeading}</div>
                <div className="text-brand-700 mt-0.5">
                  {t.users.bannerBody.split('{VAR}').map((part, i, arr) => (
                    <span key={i}>
                      {part}
                      {i < arr.length - 1 && <span className="font-mono">TEAM_API_KEY</span>}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-surface-700 mb-1.5">{t.users.projectsLabel}</label>
              {knownProjects.length > 0 ? (
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border border-surface-200 rounded-lg">
                  {knownProjects.map((p) => (
                    <label
                      key={p}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium cursor-pointer ${
                        form.projects.has(p)
                          ? 'bg-brand-100 text-brand-700'
                          : 'bg-surface-50 text-surface-600 hover:bg-surface-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={form.projects.has(p)}
                        onChange={() => toggleProject(p)}
                        className="accent-brand-600"
                      />
                      {p}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-surface-400">{t.users.noKnownProjects}</p>
              )}
              <input
                value={form.extraProjects}
                onChange={(e) => setForm((f) => ({ ...f, extraProjects: e.target.value }))}
                placeholder={t.users.additionalProjects}
                className="mt-2 w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
              />
            </div>
          </div>
          <div className="px-5 py-4 border-t border-surface-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-surface-600 hover:bg-surface-100"
            >
              {t.users.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {submitting ? t.users.creating : t.users.createUser}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!createdKey} onClose={() => setCreatedKey(null)} width={520}>
        <div className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <Icon icon="lucide:check-circle" className="text-xl text-emerald-500" />
            </div>
            <div>
              <h2 className="text-base font-bold text-surface-900">{t.users.userCreated}</h2>
              <p className="text-xs text-surface-500">{t.users.userCreatedHint}</p>
            </div>
          </div>
          {createdKey?.user && (
            <div className="space-y-3 mt-4">
              <div>
                <div className="text-xs text-surface-400 font-semibold uppercase tracking-wider mb-1">{t.users.nameLabel}</div>
                <div className="text-sm font-semibold text-surface-900">{createdKey.user.name}</div>
              </div>
              <div>
                <div className="text-xs text-surface-400 font-semibold uppercase tracking-wider mb-1">{t.users.apiKey}</div>
                <div className="flex items-center gap-2 px-3 py-2 bg-surface-50 rounded-lg border border-surface-100">
                  <span className="flex-1 font-mono text-xs break-all">{createdKey.user.key}</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(createdKey.user.key)}
                    className="text-xs text-brand-600 font-semibold hover:underline whitespace-nowrap"
                  >
                    {t.users.copy}
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setCreatedKey(null)}
              className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold"
            >
              {t.users.done}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
