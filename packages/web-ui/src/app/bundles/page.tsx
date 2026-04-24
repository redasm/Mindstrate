'use client';

import { useState } from 'react';

type BundleValidation = {
  valid: boolean;
  errors: string[];
};

type BundleInstallResult = {
  installedNodes: number;
  updatedNodes: number;
  installedEdges: number;
  skippedEdges: number;
};

export default function BundlesPage() {
  const [createForm, setCreateForm] = useState({
    name: '',
    version: '0.1.0',
    description: '',
    project: '',
  });
  const [bundleJson, setBundleJson] = useState('');
  const [registryInstall, setRegistryInstall] = useState({
    registry: '',
    reference: '',
  });
  const [createdBundle, setCreatedBundle] = useState('');
  const [validation, setValidation] = useState<BundleValidation | null>(null);
  const [installResult, setInstallResult] = useState<BundleInstallResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'create' | 'validate' | 'install' | 'install-ref' | null>(null);

  const createBundle = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('create');
    setError('');
    setCreatedBundle('');
    setValidation(null);
    setInstallResult(null);

    try {
      const res = await fetch('/api/bundles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name,
          version: createForm.version || undefined,
          description: createForm.description || undefined,
          project: createForm.project || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create bundle');
      const json = JSON.stringify(data, null, 2);
      setCreatedBundle(json);
      setBundleJson(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bundle');
    } finally {
      setBusy(null);
    }
  };

  const validateBundle = async () => {
    setBusy('validate');
    setError('');
    setValidation(null);
    setInstallResult(null);

    try {
      const bundle = JSON.parse(bundleJson);
      const res = await fetch('/api/bundles/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to validate bundle');
      setValidation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate bundle');
    } finally {
      setBusy(null);
    }
  };

  const installBundle = async () => {
    setBusy('install');
    setError('');
    setInstallResult(null);

    try {
      const bundle = JSON.parse(bundleJson);
      const res = await fetch('/api/bundles/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to install bundle');
      setInstallResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install bundle');
    } finally {
      setBusy(null);
    }
  };

  const installRegistryBundle = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('install-ref');
    setError('');
    setInstallResult(null);

    try {
      const res = await fetch('/api/bundles/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registryInstall),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to install bundle reference');
      setInstallResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install bundle reference');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Portable Bundles</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create, validate, and install portable ECS context bundles directly from the web UI.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={createBundle} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Create Bundle</h2>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="ecs-core-rules"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Version</label>
              <input
                value={createForm.version}
                onChange={(e) => setCreateForm((f) => ({ ...f, version: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Project</label>
              <input
                value={createForm.project}
                onChange={(e) => setCreateForm((f) => ({ ...f, project: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="mindstrate"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              rows={4}
              placeholder="Bundle of high-value ECS rules and patterns"
            />
          </div>
          <button
            type="submit"
            disabled={busy === 'create' || !createForm.name.trim()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy === 'create' ? 'Creating...' : 'Create Bundle'}
          </button>
        </form>

        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Bundle Payload</h2>
          <textarea
            value={bundleJson}
            onChange={(e) => setBundleJson(e.target.value)}
            className="min-h-[320px] w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
            placeholder="Paste or generate bundle JSON here"
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={validateBundle}
              disabled={busy === 'validate' || !bundleJson.trim()}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === 'validate' ? 'Validating...' : 'Validate'}
            </button>
            <button
              type="button"
              onClick={installBundle}
              disabled={busy === 'install' || !bundleJson.trim()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {busy === 'install' ? 'Installing...' : 'Install'}
            </button>
          </div>
        </div>
      </section>

      <form onSubmit={installRegistryBundle} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Install from Registry</h2>
          <p className="mt-1 text-sm text-gray-500">
            Install a versioned bundle from a local registry index, for example <code>ecs-core-rules@1.0.0</code>.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Registry Directory</label>
            <input
              value={registryInstall.registry}
              onChange={(e) => setRegistryInstall((f) => ({ ...f, registry: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder=".mindstrate/bundles-registry"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Bundle Reference</label>
            <input
              value={registryInstall.reference}
              onChange={(e) => setRegistryInstall((f) => ({ ...f, reference: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="ecs-core-rules@1.0.0"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={busy === 'install-ref' || !registryInstall.registry.trim() || !registryInstall.reference.trim()}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {busy === 'install-ref' ? 'Installing...' : 'Install Reference'}
        </button>
      </form>

      {validation ? (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Validation Result</h2>
          <p className={`mt-2 text-sm ${validation.valid ? 'text-emerald-700' : 'text-red-700'}`}>
            {validation.valid ? 'Bundle is valid.' : 'Bundle validation failed.'}
          </p>
          {!validation.valid && validation.errors.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700">
              {validation.errors.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
        </section>
      ) : null}

      {installResult ? (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Install Result</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Installed Nodes" value={installResult.installedNodes} />
            <Stat label="Updated Nodes" value={installResult.updatedNodes} />
            <Stat label="Installed Edges" value={installResult.installedEdges} />
            <Stat label="Skipped Edges" value={installResult.skippedEdges} />
          </div>
        </section>
      ) : null}

      {createdBundle ? (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Latest Created Bundle</h2>
          <p className="mt-2 text-sm text-gray-500">
            The newly created bundle has been loaded into the payload editor and can be validated or installed elsewhere.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}
