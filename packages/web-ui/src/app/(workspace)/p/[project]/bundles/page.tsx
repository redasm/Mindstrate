'use client';

import { useState, use } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';

type BundleValidation = { valid: boolean; errors: string[] };
type BundleInstallResult = {
  installedNodes: number;
  updatedNodes: number;
  installedEdges: number;
  skippedEdges: number;
};
type BundlePublication = {
  manifest: {
    name: string;
    version: string;
    registry: string;
    visibility: string;
    nodeCount: number;
    edgeCount: number;
    digest: string;
  };
};

export default function ProjectBundlesPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = use(params);
  const decoded = decodeURIComponent(project);
  const tAll = useTranslations();
  const t = tAll.bundles;
  const [createForm, setCreateForm] = useState({ name: '', version: '0.1.0', description: '' });
  const [bundleJson, setBundleJson] = useState('');
  const [registryInstall, setRegistryInstall] = useState({ registry: '', reference: '' });
  const [publishForm, setPublishForm] = useState({ registry: '', visibility: 'unlisted' });
  const [validation, setValidation] = useState<BundleValidation | null>(null);
  const [installResult, setInstallResult] = useState<BundleInstallResult | null>(null);
  const [publication, setPublication] = useState<BundlePublication | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const createBundle = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('create');
    setError('');
    setValidation(null);
    setInstallResult(null);
    setPublication(null);
    try {
      const resp = await fetch('/api/bundles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...createForm, project: decoded }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || t.failedGeneric);
      setBundleJson(JSON.stringify(data, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failedGeneric);
    } finally {
      setBusy(null);
    }
  };

  const validateBundle = async () => {
    setBusy('validate');
    setError('');
    setValidation(null);
    try {
      const bundle = JSON.parse(bundleJson);
      const resp = await fetch('/api/bundles/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || t.failedGeneric);
      setValidation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failedGeneric);
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
      const resp = await fetch('/api/bundles/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || t.failedGeneric);
      setInstallResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failedGeneric);
    } finally {
      setBusy(null);
    }
  };

  const installRegistry = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('install-ref');
    setError('');
    setInstallResult(null);
    try {
      const resp = await fetch('/api/bundles/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registryInstall),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || t.failedGeneric);
      setInstallResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failedGeneric);
    } finally {
      setBusy(null);
    }
  };

  const publishBundle = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('publish');
    setError('');
    setPublication(null);
    try {
      const bundle = JSON.parse(bundleJson);
      const resp = await fetch('/api/bundles/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle, registry: publishForm.registry || undefined, visibility: publishForm.visibility }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || t.failedGeneric);
      setPublication(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failedGeneric);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-5">
      <div className="mb-5 anim-in d1">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold tracking-tight text-surface-900">{t.title}</h1>
          <span className="px-2 py-0.5 text-xs font-semibold text-brand-600 bg-brand-50 rounded-md border border-brand-100">{decoded}</span>
        </div>
        <p className="text-sm text-surface-500 font-medium">
          {t.description}
        </p>
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-2.5 px-3.5 py-2.5 bg-red-50 border border-red-100 rounded-xl anim-in d2">
          <Icon icon="lucide:alert-circle" className="text-red-500 text-base" />
          <span className="text-sm font-medium text-red-700">{error}</span>
        </div>
      )}

      <section className="grid gap-5 lg:grid-cols-2 mb-5">
        <form onSubmit={createBundle} className="bg-white rounded-2xl border border-surface-200 p-5 space-y-4 anim-in d2">
          <h2 className="text-base font-bold text-surface-900">{t.createBundle}</h2>
          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">{t.name}</label>
            <input
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t.namePlaceholder}
              className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">{t.version}</label>
            <input
              value={createForm.version}
              onChange={(e) => setCreateForm((f) => ({ ...f, version: e.target.value }))}
              className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">{t.description_field}</label>
            <textarea
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder={t.descriptionPlaceholder}
              className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy === 'create' || !createForm.name.trim()}
            className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <Icon icon="lucide:package-plus" className="text-sm" />
            {busy === 'create' ? t.creating : t.createBundle}
          </button>
        </form>

        <div className="bg-white rounded-2xl border border-surface-200 p-5 space-y-3 anim-in d3">
          <h2 className="text-base font-bold text-surface-900">{t.bundlePayload}</h2>
          <textarea
            value={bundleJson}
            onChange={(e) => setBundleJson(e.target.value)}
            rows={14}
            placeholder={t.payloadPlaceholder}
            className="w-full px-3 py-2 border border-surface-200 rounded-lg font-mono text-xs focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={validateBundle}
              disabled={busy === 'validate' || !bundleJson.trim()}
              className="btn-outline px-3 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Icon icon="lucide:check-circle" className="text-sm" />
              {busy === 'validate' ? t.validating : t.validateBtn}
            </button>
            <button
              type="button"
              onClick={installBundle}
              disabled={busy === 'install' || !bundleJson.trim()}
              className="btn-primary px-3 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Icon icon="lucide:download" className="text-sm" />
              {busy === 'install' ? t.installing : t.installBtn}
            </button>
          </div>
        </div>
      </section>

      <form onSubmit={installRegistry} className="bg-white rounded-2xl border border-surface-200 p-5 mb-5 anim-in d4">
        <h2 className="text-base font-bold text-surface-900 mb-1">{t.installFromRegistry}</h2>
        <p className="text-sm text-surface-500 mb-4">
          {t.installFromRegistryHintPrefix} <code className="font-mono text-xs">ecs-core-rules@1.0.0</code>.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 mb-4">
          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">{t.registryDirectory}</label>
            <input
              value={registryInstall.registry}
              onChange={(e) => setRegistryInstall((f) => ({ ...f, registry: e.target.value }))}
              placeholder={t.registryDirectoryPlaceholder}
              className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">{t.bundleReference}</label>
            <input
              value={registryInstall.reference}
              onChange={(e) => setRegistryInstall((f) => ({ ...f, reference: e.target.value }))}
              placeholder={t.bundleReferencePlaceholder}
              className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={busy === 'install-ref' || !registryInstall.registry.trim() || !registryInstall.reference.trim()}
          className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold"
        >
          {busy === 'install-ref' ? t.installingRef : t.installReference}
        </button>
      </form>

      <form onSubmit={publishBundle} className="bg-white rounded-2xl border border-surface-200 p-5 mb-5 anim-in d5">
        <h2 className="text-base font-bold text-surface-900 mb-1">{t.publishBundle}</h2>
        <p className="text-sm text-surface-500 mb-4">{t.publishBundleHint}</p>
        <div className="grid gap-4 sm:grid-cols-2 mb-4">
          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">{t.registry}</label>
            <input
              value={publishForm.registry}
              onChange={(e) => setPublishForm((f) => ({ ...f, registry: e.target.value }))}
              placeholder={t.registryPlaceholder}
              className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">{t.visibility}</label>
            <select
              value={publishForm.visibility}
              onChange={(e) => setPublishForm((f) => ({ ...f, visibility: e.target.value }))}
              className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            >
              <option value="unlisted">{t.visibilityUnlisted}</option>
              <option value="public">{t.visibilityPublic}</option>
              <option value="private">{t.visibilityPrivate}</option>
            </select>
          </div>
        </div>
        <button type="submit" disabled={busy === 'publish' || !bundleJson.trim()} className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold">
          {busy === 'publish' ? t.publishing : t.publishBtn}
        </button>
      </form>

      {validation && (
        <section className="bg-white rounded-2xl border border-surface-200 p-5 mb-5">
          <h2 className="text-base font-bold text-surface-900 mb-2">{t.validationResult}</h2>
          <p className={`text-sm font-semibold ${validation.valid ? 'text-emerald-600' : 'text-red-600'}`}>
            {validation.valid ? t.bundleValid : t.bundleInvalid}
          </p>
          {!validation.valid && validation.errors.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700">
              {validation.errors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {installResult && (
        <section className="bg-white rounded-2xl border border-surface-200 p-5 mb-5">
          <h2 className="text-base font-bold text-surface-900 mb-3">{t.installResult}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t.installedNodes} value={installResult.installedNodes} />
            <Stat label={t.updatedNodes} value={installResult.updatedNodes} />
            <Stat label={t.installedEdges} value={installResult.installedEdges} />
            <Stat label={t.skippedEdges} value={installResult.skippedEdges} />
          </div>
        </section>
      )}

      {publication && (
        <section className="bg-white rounded-2xl border border-surface-200 p-5 mb-5">
          <h2 className="text-base font-bold text-surface-900 mb-3">{t.publicationManifest}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-3">
            <Stat label={t.nodes} value={publication.manifest.nodeCount} />
            <Stat label={t.edges} value={publication.manifest.edgeCount} />
          </div>
          <dl className="text-sm text-surface-700 space-y-1">
            <div>
              <dt className="inline font-semibold">{t.nameLabel}</dt>{' '}
              <dd className="inline">{publication.manifest.name}@{publication.manifest.version}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">{t.registryLabel}</dt> <dd className="inline">{publication.manifest.registry}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">{t.visibilityLabel}</dt> <dd className="inline">{publication.manifest.visibility}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">{t.digestLabel}</dt>{' '}
              <dd className="inline break-all font-mono text-xs">{publication.manifest.digest}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-surface-100 bg-surface-50 p-4">
      <div className="text-[11px] uppercase tracking-wide text-surface-400 font-semibold">{label}</div>
      <div className="mt-1 text-2xl font-bold text-surface-900">{value}</div>
    </div>
  );
}
