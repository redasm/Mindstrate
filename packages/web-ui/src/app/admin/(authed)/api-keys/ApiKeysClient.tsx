'use client';

import { useState } from 'react';
import type { ApiKey, ApiKeyScope } from '@mindstrate/protocol';

interface Props {
  initialKeys: ApiKey[];
  knownProjects: string[];
}

const SCOPE_OPTIONS: ApiKeyScope[] = ['read', 'write', 'admin'];

export function ApiKeysClient({ initialKeys, knownProjects }: Props) {
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(new Set(['read', 'write']));
  const [projects, setProjects] = useState<Set<string>>(new Set());
  const [extraProjectInput, setExtraProjectInput] = useState('');
  const [wildcardProjects, setWildcardProjects] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealedKeyId, setRevealedKeyId] = useState<string | null>(null);

  const toggleScope = (scope: ApiKeyScope) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const toggleProject = (project: string) => {
    setProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const projectList = wildcardProjects
      ? ['*']
      : [
          ...projects,
          ...extraProjectInput
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
        ];
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (scopes.size === 0) {
      setError('Pick at least one scope.');
      return;
    }
    if (projectList.length === 0) {
      setError('Pick at least one project (or enable wildcard).');
      return;
    }

    setSubmitting(true);
    const res = await fetch('/api/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        scopes: [...scopes],
        projects: projectList,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Create failed (${res.status})`);
      return;
    }
    const created = (await res.json()) as ApiKey;
    setKeys((prev) => [created, ...prev]);
    setRevealedKeyId(created.id);
    setName('');
    setExtraProjectInput('');
    setProjects(new Set());
    setWildcardProjects(false);
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this key? It cannot be reactivated — you can only mint a new one.')) return;
    const res = await fetch(`/api/admin/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Revoke failed (${res.status})`);
      return;
    }
    setKeys((prev) => prev.filter((entry) => entry.id !== id));
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleCreate}
        className="bg-white border border-gray-200 rounded-lg p-4 space-y-3"
      >
        <h2 className="font-semibold text-gray-900">Add member</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            <span className="block text-gray-700">Member name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              required
            />
          </label>
          <div className="text-sm space-y-1">
            <span className="block text-gray-700">Scopes</span>
            <div className="flex flex-wrap gap-3 pt-1">
              {SCOPE_OPTIONS.map((scope) => (
                <label key={scope} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={scopes.has(scope)}
                    onChange={() => toggleScope(scope)}
                  />
                  <span>{scope}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="text-sm space-y-1">
          <span className="block text-gray-700">Projects</span>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={wildcardProjects}
              onChange={(e) => setWildcardProjects(e.target.checked)}
            />
            <span>All projects (<code>*</code>)</span>
          </label>
          {!wildcardProjects && (
            <>
              {knownProjects.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {knownProjects.map((project) => (
                    <label key={project} className="flex items-center gap-1.5 bg-gray-50 rounded px-2 py-1">
                      <input
                        type="checkbox"
                        checked={projects.has(project)}
                        onChange={() => toggleProject(project)}
                      />
                      <span>{project}</span>
                    </label>
                  ))}
                </div>
              )}
              <input
                type="text"
                value={extraProjectInput}
                onChange={(e) => setExtraProjectInput(e.target.value)}
                placeholder="Additional projects (comma-separated)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </>
          )}
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create key'}
        </button>
      </form>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Scopes</th>
              <th className="text-left px-4 py-2">Projects</th>
              <th className="text-left px-4 py-2">Key</th>
              <th className="text-left px-4 py-2">Created</th>
              <th className="text-right px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                  No active member keys.
                </td>
              </tr>
            )}
            {keys.map((entry) => {
              const revealed = revealedKeyId === entry.id;
              return (
                <tr key={entry.id} className="border-t border-gray-200">
                  <td className="px-4 py-2 font-medium text-gray-900">{entry.name}</td>
                  <td className="px-4 py-2 text-gray-700">{entry.scopes.join(', ')}</td>
                  <td className="px-4 py-2 text-gray-700">{entry.projects.join(', ')}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">
                    {revealed ? (
                      <span className="break-all">{entry.key}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRevealedKeyId(entry.id)}
                        className="text-brand-600 hover:underline"
                      >
                        Reveal
                      </button>
                    )}
                    {revealed && (
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(entry.key)}
                        className="ml-2 text-brand-600 hover:underline"
                      >
                        Copy
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{entry.createdAt.slice(0, 19).replace('T', ' ')}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleRevoke(entry.id)}
                      className="text-red-600 hover:underline"
                    >
                      Revoke
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
