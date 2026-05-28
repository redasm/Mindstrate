'use client';

import { useState } from 'react';
import type { ScanSource, ScanSourceKind, ScanInitMode } from '@mindstrate/protocol';

interface Props {
  initialSources: ScanSource[];
  knownProjects: string[];
}

interface FormState {
  kind: ScanSourceKind;
  name: string;
  project: string;
  repoPath: string;
  branch: string;
  remoteUrl: string;
  authToken: string;
  depotPath: string;
  p4Port: string;
  p4User: string;
  p4Passwd: string;
  intervalSec: number;
  initMode: ScanInitMode;
  backfillCount: number;
}

const blankForm = (kind: ScanSourceKind = 'git-local'): FormState => ({
  kind,
  name: '',
  project: '',
  repoPath: '',
  branch: '',
  remoteUrl: '',
  authToken: '',
  depotPath: '',
  p4Port: '',
  p4User: '',
  p4Passwd: '',
  intervalSec: 300,
  initMode: 'from_now',
  backfillCount: 10,
});

export function ScannerSourcesClient({ initialSources, knownProjects }: Props) {
  const [sources, setSources] = useState<ScanSource[]>(initialSources);
  const [form, setForm] = useState<FormState>(blankForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealedId, setRevealedId] = useState<string | null>(null);

  const setFormField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setForm(blankForm());
    setEditingId(null);
    setError(null);
  };

  const loadIntoForm = (source: ScanSource) => {
    setEditingId(source.id);
    setError(null);
    setForm({
      kind: source.kind,
      name: source.name,
      project: source.project,
      repoPath: source.repoPath ?? '',
      branch: source.branch ?? '',
      remoteUrl: source.remoteUrl ?? '',
      authToken: source.authToken ?? '',
      depotPath: source.depotPath ?? '',
      p4Port: source.p4Port ?? '',
      p4User: source.p4User ?? '',
      p4Passwd: source.p4Passwd ?? '',
      intervalSec: source.intervalSec,
      initMode: source.initMode,
      backfillCount: source.backfillCount,
    });
  };

  const buildPayload = () => {
    const base = {
      name: form.name.trim(),
      project: form.project.trim(),
      intervalSec: form.intervalSec,
      initMode: form.initMode,
      backfillCount: form.backfillCount,
    };
    if (form.kind === 'git-local') {
      return {
        kind: 'git-local' as const,
        ...base,
        repoPath: form.repoPath.trim() || undefined,
        branch: form.branch.trim() || undefined,
        remoteUrl: form.remoteUrl.trim() || undefined,
        authToken: form.authToken.trim() || undefined,
      };
    }
    return {
      kind: 'p4' as const,
      ...base,
      depotPath: form.depotPath.trim() || undefined,
      p4Port: form.p4Port.trim() || undefined,
      p4User: form.p4User.trim() || undefined,
      p4Passwd: form.p4Passwd,
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.project.trim()) {
      setError('Name and project are required.');
      return;
    }
    if (form.kind === 'git-local' && !form.repoPath.trim() && !form.remoteUrl.trim()) {
      setError('Provide a repo path or a remote URL.');
      return;
    }
    if (form.kind === 'p4' && !form.depotPath.trim()) {
      setError('Depot path is required for P4 sources.');
      return;
    }

    setSubmitting(true);
    const payload = buildPayload();
    const url = editingId
      ? `/api/admin/scanner-sources/${encodeURIComponent(editingId)}`
      : '/api/admin/scanner-sources';
    const res = await fetch(url, {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Save failed (${res.status})`);
      return;
    }
    const saved = (await res.json()) as ScanSource;
    setSources((prev) => {
      const filtered = prev.filter((entry) => entry.id !== saved.id);
      return editingId ? [...filtered, saved].sort(byCreatedAt) : [saved, ...filtered];
    });
    resetForm();
  };

  const toggleEnabled = async (source: ScanSource) => {
    const res = await fetch(`/api/admin/scanner-sources/${encodeURIComponent(source.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !source.enabled }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Toggle failed (${res.status})`);
      return;
    }
    const updated = (await res.json()) as ScanSource;
    setSources((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
  };

  const handleDelete = async (source: ScanSource) => {
    if (!confirm(`Delete source "${source.name}"? Failed-item history is removed too.`)) return;
    const res = await fetch(`/api/admin/scanner-sources/${encodeURIComponent(source.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Delete failed (${res.status})`);
      return;
    }
    setSources((prev) => prev.filter((entry) => entry.id !== source.id));
    if (editingId === source.id) resetForm();
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-gray-200 rounded-lg p-4 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            {editingId ? 'Edit source' : 'Add source'}
          </h2>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel edit
            </button>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            <span className="block text-gray-700">Kind</span>
            <select
              value={form.kind}
              onChange={(e) => setFormField('kind', e.target.value as ScanSourceKind)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              disabled={!!editingId}
            >
              <option value="git-local">git-local</option>
              <option value="p4">p4</option>
            </select>
          </label>
          <label className="text-sm space-y-1">
            <span className="block text-gray-700">Name</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setFormField('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              required
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="block text-gray-700">Project</span>
            <input
              type="text"
              list="known-projects"
              value={form.project}
              onChange={(e) => setFormField('project', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              required
            />
            <datalist id="known-projects">
              {knownProjects.map((p) => <option key={p} value={p} />)}
            </datalist>
          </label>
          <label className="text-sm space-y-1">
            <span className="block text-gray-700">Interval (seconds)</span>
            <input
              type="number"
              min={30}
              value={form.intervalSec}
              onChange={(e) => setFormField('intervalSec', Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="block text-gray-700">Init mode</span>
            <select
              value={form.initMode}
              onChange={(e) => setFormField('initMode', e.target.value as ScanInitMode)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="from_now">from_now</option>
              <option value="backfill_recent">backfill_recent</option>
            </select>
          </label>
          <label className="text-sm space-y-1">
            <span className="block text-gray-700">Backfill count</span>
            <input
              type="number"
              min={0}
              value={form.backfillCount}
              onChange={(e) => setFormField('backfillCount', Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </label>
        </div>

        {form.kind === 'git-local' ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm space-y-1">
              <span className="block text-gray-700">Repo path (on scanner host)</span>
              <input
                type="text"
                value={form.repoPath}
                onChange={(e) => setFormField('repoPath', e.target.value)}
                placeholder="/repos/<auto>"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="block text-gray-700">Branch</span>
              <input
                type="text"
                value={form.branch}
                onChange={(e) => setFormField('branch', e.target.value)}
                placeholder="main"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </label>
            <label className="text-sm space-y-1 sm:col-span-2">
              <span className="block text-gray-700">Remote URL (optional — auto-clone if set)</span>
              <input
                type="text"
                value={form.remoteUrl}
                onChange={(e) => setFormField('remoteUrl', e.target.value)}
                placeholder="https://github.com/acme/app.git"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </label>
            <label className="text-sm space-y-1 sm:col-span-2">
              <span className="block text-gray-700">Auth token (bearer; sent via http.extraheader)</span>
              <input
                type="password"
                value={form.authToken}
                onChange={(e) => setFormField('authToken', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
              />
            </label>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm space-y-1 sm:col-span-2">
              <span className="block text-gray-700">Depot path</span>
              <input
                type="text"
                value={form.depotPath}
                onChange={(e) => setFormField('depotPath', e.target.value)}
                placeholder="//depot/main/..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="block text-gray-700">P4PORT</span>
              <input
                type="text"
                value={form.p4Port}
                onChange={(e) => setFormField('p4Port', e.target.value)}
                placeholder="ssl:p4.acme.com:1666"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="block text-gray-700">P4USER</span>
              <input
                type="text"
                value={form.p4User}
                onChange={(e) => setFormField('p4User', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </label>
            <label className="text-sm space-y-1 sm:col-span-2">
              <span className="block text-gray-700">P4PASSWD</span>
              <input
                type="password"
                value={form.p4Passwd}
                onChange={(e) => setFormField('p4Passwd', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
              />
            </label>
          </div>
        )}

        {error && <div className="text-sm text-red-600">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
        >
          {submitting ? 'Saving…' : editingId ? 'Save changes' : 'Add source'}
        </button>
      </form>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="text-left px-4 py-2">Kind</th>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Project</th>
              <th className="text-left px-4 py-2">Target</th>
              <th className="text-left px-4 py-2">Remote</th>
              <th className="text-left px-4 py-2">Secret</th>
              <th className="text-left px-4 py-2">Last run</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-right px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-gray-400">
                  No scanner sources configured.
                </td>
              </tr>
            )}
            {sources.map((entry) => {
              const revealed = revealedId === entry.id;
              const secret = entry.kind === 'git-local' ? entry.authToken : entry.p4Passwd;
              const target = entry.kind === 'git-local'
                ? entry.repoPath ?? '(auto)'
                : entry.depotPath ?? '//...';
              const remote = entry.kind === 'git-local'
                ? entry.remoteUrl ?? '—'
                : entry.p4Port ? `${entry.p4Port} (${entry.p4User ?? 'inherit'})` : 'inherit env';
              return (
                <tr key={entry.id} className="border-t border-gray-200 align-top">
                  <td className="px-4 py-2 text-gray-700">{entry.kind}</td>
                  <td className="px-4 py-2 font-medium text-gray-900">{entry.name}</td>
                  <td className="px-4 py-2 text-gray-700">{entry.project}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">{target}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700 max-w-xs truncate">{remote}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">
                    {!secret ? (
                      <span className="text-gray-400">—</span>
                    ) : revealed ? (
                      <span className="break-all">{secret}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRevealedId(entry.id)}
                        className="text-brand-600 hover:underline"
                      >
                        Reveal
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500">
                    {entry.lastRunAt ? entry.lastRunAt.slice(0, 19).replace('T', ' ') : 'never'}
                  </td>
                  <td className="px-4 py-2">
                    {entry.lastError ? (
                      <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">error</span>
                    ) : entry.enabled ? (
                      <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">on</span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">off</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleEnabled(entry)}
                      className="text-brand-600 hover:underline"
                    >
                      {entry.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => loadIntoForm(entry)}
                      className="text-brand-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(entry)}
                      className="text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function byCreatedAt(a: ScanSource, b: ScanSource): number {
  return a.createdAt.localeCompare(b.createdAt);
}
