'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ScanSourceKind, ScanInitMode } from '@mindstrate/protocol';
import { Icon } from '@/components/ui/Icon';
import { Toggle } from '@/components/ui/Toggle';
import { useTranslations } from '@/lib/i18n/hooks';
import type { Translations } from '@/lib/i18n/en';
import type { ScannerSourceView } from '@/lib/scanner-source-view';

interface Props {
  initialSources: ScannerSourceView[];
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
  intervalSec: 60,
  initMode: 'from_now',
  backfillCount: 500,
});

function timeAgo(iso: string | undefined, t: Translations['scannerSources']): string {
  if (!iso) return t.never;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return t.never;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}${t.secondsAgo}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}${t.minutesAgo}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${t.hoursAgo}`;
  return `${Math.floor(h / 24)}${t.daysAgo}`;
}

function truncate(value: string | undefined, max = 24): string {
  if (!value) return '—';
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function ScannerSourcesClient({ initialSources, knownProjects }: Props) {
  const searchParams = useSearchParams();
  const tAll = useTranslations();
  const t = tAll.scannerSources;
  const [sources, setSources] = useState<ScannerSourceView[]>(initialSources);
  const [showPanel, setShowPanel] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [errorDetailId, setErrorDetailId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  const counts = useMemo(() => {
    let active = 0;
    let disabled = 0;
    let errored = 0;
    for (const s of sources) {
      if (s.lastError) errored += 1;
      else if (s.enabled) active += 1;
      else disabled += 1;
    }
    return { total: sources.length, active, disabled, errored };
  }, [sources]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch('/api/admin/scanner-sources', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json().catch(() => null) as { sources?: ScannerSourceView[] } | null;
        if (!cancelled && Array.isArray(body?.sources)) {
          setSources(body.sources);
        }
      } catch {
        return;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const project = searchParams.get('project');
    setProjectFilter(project && project.trim() ? project : null);
  }, [searchParams]);

  useEffect(() => {
    const requestedKind = searchParams.get('new');
    if (requestedKind === 'git' || requestedKind === 'p4') {
      const seeded = blankForm(requestedKind === 'p4' ? 'p4' : 'git-local');
      const project = searchParams.get('project');
      setForm(project ? { ...seeded, project } : seeded);
      setEditingId(null);
      setError(null);
      setShowAuthToken(false);
      setShowPanel(true);
    }
  }, [searchParams]);

  const visibleSources = useMemo(
    () => (projectFilter ? sources.filter((s) => s.project === projectFilter) : sources),
    [sources, projectFilter],
  );

  const setFormField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setForm(blankForm());
    setEditingId(null);
    setError(null);
    setShowAuthToken(false);
  };

  const closePanel = () => {
    setShowPanel(false);
    resetForm();
  };

  const openCreate = () => {
    resetForm();
    if (projectFilter) {
      setForm((prev) => ({ ...prev, project: projectFilter }));
    }
    setShowPanel(true);
  };

  const openEdit = (source: ScannerSourceView) => {
    setEditingId(source.id);
    setError(null);
    setShowAuthToken(false);
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
    setShowPanel(true);
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
      repoPath: form.repoPath.trim() || undefined,
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
      setError(t.nameProjectRequired);
      return;
    }
    if (form.kind === 'git-local' && !form.repoPath.trim() && !form.remoteUrl.trim()) {
      setError(t.repoOrRemoteRequired);
      return;
    }
    if (form.kind === 'p4' && !form.depotPath.trim()) {
      setError(t.depotPathRequired);
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
      setError(body.error ?? `${t.saveFailedPrefix} (${res.status})`);
      return;
    }
    const saved = (await res.json()) as ScannerSourceView;
    setSources((prev) => {
      const filtered = prev.filter((entry) => entry.id !== saved.id);
      return editingId ? [...filtered, saved].sort(byCreatedAt) : [saved, ...filtered];
    });
    closePanel();
  };

  const toggleEnabled = async (source: ScannerSourceView) => {
    const res = await fetch(`/api/admin/scanner-sources/${encodeURIComponent(source.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !source.enabled }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `${t.toggleFailedPrefix} (${res.status})`);
      return;
    }
    const updated = (await res.json()) as ScannerSourceView;
    setSources((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
  };

  const handleDelete = async (source: ScannerSourceView) => {
    if (!confirm(t.deleteConfirm.replace('{NAME}', source.name))) return;
    const res = await fetch(`/api/admin/scanner-sources/${encodeURIComponent(source.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `${t.deleteFailedPrefix} (${res.status})`);
      return;
    }
    setSources((prev) => prev.filter((entry) => entry.id !== source.id));
    if (editingId === source.id) closePanel();
  };

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-5">
      <div className="flex items-end justify-between mb-6 anim-in d1 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-surface-900 mb-1">{t.title}</h1>
          <p className="text-sm text-surface-500 font-medium">
            {t.description}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Icon icon="lucide:plus-circle" className="text-sm" />
          {t.addSource}
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5 anim-in d2 flex-wrap">
        <SummaryPill label={t.summaryTotal} value={counts.total} />
        <SummaryPill label={t.summaryActive} value={counts.active} dotColor="bg-emerald-400" />
        <SummaryPill label={t.summaryDisabled} value={counts.disabled} dotColor="bg-surface-300" />
        <SummaryPill label={t.summaryErrored} value={counts.errored} dotColor="bg-red-400" />
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-2.5 px-3.5 py-2.5 bg-red-50 border border-red-100 rounded-xl">
          <Icon icon="lucide:alert-circle" className="text-red-500 text-base" />
          <span className="text-sm font-medium text-red-700">{error}</span>
        </div>
      )}

      {projectFilter && (
        <div className="mb-5 flex items-center justify-between gap-2.5 px-3.5 py-2.5 bg-brand-50 border border-brand-100 rounded-xl">
          <span className="text-sm font-medium text-brand-700 flex items-center gap-2">
            <Icon icon="lucide:filter" className="text-base" />
            {t.filteredByProject} <span className="font-semibold">{projectFilter}</span>
          </span>
          <button
            type="button"
            onClick={() => setProjectFilter(null)}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            {t.clearProjectFilter}
          </button>
        </div>
      )}

      {showPanel && (
        <form
          onSubmit={handleSubmit}
          className="add-panel rounded-2xl mb-6 bg-white border border-surface-200 anim-in d3"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center">
                <Icon icon="lucide:radar" className="text-lg text-brand-500" />
              </div>
              <div>
                <h2 className="text-base font-bold tracking-tight text-surface-900">
                  {editingId ? t.panelEdit : t.panelAdd}
                </h2>
                <p className="text-xs text-surface-400 font-medium">
                  {t.panelSubtitle}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={closePanel}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-600"
              title={t.panelClose}
            >
              <Icon icon="lucide:x" className="text-base" />
            </button>
          </div>

          <div className="px-5 py-5 space-y-5">
            <div>
              <label className="block text-[11px] font-bold text-surface-400 uppercase tracking-wider mb-2">
                {t.kindLabel}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <KindTab
                  selected={form.kind === 'git-local'}
                  icon="lucide:git-branch"
                  iconClass="text-brand-500"
                  title={t.kindGit}
                  desc={t.kindGitHint}
                  disabled={!!editingId}
                  onClick={() => setFormField('kind', 'git-local')}
                />
                <KindTab
                  selected={form.kind === 'p4'}
                  icon="lucide:database"
                  iconClass="text-amber-500"
                  title={t.kindP4}
                  desc={t.kindP4Hint}
                  disabled={!!editingId}
                  onClick={() => setFormField('kind', 'p4')}
                />
              </div>
              {editingId && (
                <p className="text-[10px] text-surface-400 mt-1 ml-1">{t.kindLockedHint}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              <Field label={t.name} icon="lucide:tag">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setFormField('name', e.target.value)}
                  placeholder={t.namePlaceholder}
                  className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-medium text-surface-800 placeholder-surface-400 outline-none"
                />
              </Field>
              <Field label={t.project} icon="lucide:folder">
                <input
                  type="text"
                  list="scanner-known-projects"
                  value={form.project}
                  onChange={(e) => setFormField('project', e.target.value)}
                  placeholder={t.projectPlaceholder}
                  className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-medium text-surface-800 placeholder-surface-400 outline-none"
                />
                <datalist id="scanner-known-projects">
                  {knownProjects.map((p) => <option key={p} value={p} />)}
                </datalist>
              </Field>

              {form.kind === 'git-local' ? (
                <>
                  <Field label={t.repoPath} icon="lucide:folder-tree" hint={t.repoPathHint}>
                    <input
                      type="text"
                      value={form.repoPath}
                      onChange={(e) => setFormField('repoPath', e.target.value)}
                      placeholder={t.repoPathPlaceholder}
                      className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                    />
                  </Field>
                  <Field label={t.branch} icon="lucide:git-branch">
                    <input
                      type="text"
                      value={form.branch}
                      onChange={(e) => setFormField('branch', e.target.value)}
                      placeholder={t.branchPlaceholder}
                      className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                    />
                  </Field>
                  <Field
                    label={t.remoteUrl}
                    suffixLabel={t.remoteUrlSuffix}
                    icon="lucide:link"
                    colSpan={2}
                  >
                    <input
                      type="text"
                      value={form.remoteUrl}
                      onChange={(e) => setFormField('remoteUrl', e.target.value)}
                      placeholder={t.remoteUrlPlaceholder}
                      className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                    />
                  </Field>
                  <Field
                    label={t.authToken}
                    suffixLabel={t.authTokenSuffix}
                    icon="lucide:key-round"
                    colSpan={2}
                  >
                    <input
                      type={showAuthToken ? 'text' : 'password'}
                      value={form.authToken}
                      onChange={(e) => setFormField('authToken', e.target.value)}
                      placeholder={t.authTokenPlaceholder}
                      className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAuthToken((v) => !v)}
                      className="reveal-btn mr-2 p-1.5 rounded-lg text-surface-400"
                      title={showAuthToken ? t.hide : t.reveal}
                    >
                      <Icon icon={showAuthToken ? 'lucide:eye-off' : 'lucide:eye'} className="text-sm" />
                    </button>
                  </Field>
                </>
              ) : (
                <>
                  <Field label={t.depotPath} icon="lucide:folder-tree" colSpan={2}>
                    <input
                      type="text"
                      value={form.depotPath}
                      onChange={(e) => setFormField('depotPath', e.target.value)}
                      placeholder={t.depotPathPlaceholder}
                      className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                    />
                  </Field>
                  <Field label={t.repoPath} icon="lucide:folder-tree" hint={t.p4RepoPathHint} colSpan={2}>
                    <input
                      type="text"
                      value={form.repoPath}
                      onChange={(e) => setFormField('repoPath', e.target.value)}
                      placeholder={t.p4RepoPathPlaceholder}
                      className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                    />
                  </Field>
                  <Field label={t.p4Port} icon="lucide:server">
                    <input
                      type="text"
                      value={form.p4Port}
                      onChange={(e) => setFormField('p4Port', e.target.value)}
                      placeholder={t.p4PortPlaceholder}
                      className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                    />
                  </Field>
                  <Field label={t.p4User} icon="lucide:user">
                    <input
                      type="text"
                      value={form.p4User}
                      onChange={(e) => setFormField('p4User', e.target.value)}
                      placeholder={t.p4UserPlaceholder}
                      className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                    />
                  </Field>
                  <Field
                    label={t.p4Passwd}
                    suffixLabel={t.p4PasswdSuffix}
                    icon="lucide:key-round"
                    colSpan={2}
                  >
                    <input
                      type={showAuthToken ? 'text' : 'password'}
                      value={form.p4Passwd}
                      onChange={(e) => setFormField('p4Passwd', e.target.value)}
                      className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAuthToken((v) => !v)}
                      className="reveal-btn mr-2 p-1.5 rounded-lg text-surface-400"
                      title={showAuthToken ? t.hide : t.reveal}
                    >
                      <Icon icon={showAuthToken ? 'lucide:eye-off' : 'lucide:eye'} className="text-sm" />
                    </button>
                  </Field>
                </>
              )}

              <Field label={t.intervalSec} icon="lucide:timer">
                <input
                  type="number"
                  min={30}
                  value={form.intervalSec}
                  onChange={(e) => setFormField('intervalSec', Number(e.target.value))}
                  className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 outline-none"
                />
              </Field>
              <Field label={t.initMode} icon="lucide:rocket">
                <select
                  value={form.initMode}
                  onChange={(e) => setFormField('initMode', e.target.value as ScanInitMode)}
                  className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-medium text-surface-800 outline-none appearance-none"
                >
                  <option value="from_now">{t.initFromNow}</option>
                  <option value="backfill_recent">{t.initBackfill}</option>
                </select>
                <Icon icon="lucide:chevron-down" className="mr-3 text-sm text-surface-400" />
              </Field>
              <Field
                label={t.backfillCount}
                suffixLabel={t.backfillSuffix}
                icon="lucide:history"
                colSpan={2}
              >
                <input
                  type="number"
                  min={0}
                  value={form.backfillCount}
                  onChange={(e) => setFormField('backfillCount', Number(e.target.value))}
                  className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 outline-none max-w-[200px]"
                />
              </Field>
            </div>
          </div>

          <div className="px-5 py-4 border-t border-surface-100 bg-surface-50 flex items-center justify-between rounded-b-2xl gap-3 flex-wrap">
            <div className="flex items-start gap-2 text-xs text-surface-500">
              <Icon icon="lucide:info" className="text-sm text-surface-400 mt-0.5" />
              <span className="font-medium">
                {t.credsNote}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={closePanel}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-surface-600 hover:bg-surface-100 border border-surface-200 bg-white"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary px-5 py-2 rounded-lg text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Icon icon="lucide:check" className="text-sm" />
                {submitting ? t.saving : editingId ? t.update : t.save}
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden anim-in d4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-surface-50 text-left text-[11px] font-bold text-surface-400 uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3">{t.table.kind}</th>
                <th className="px-3 py-3">{t.table.name}</th>
                <th className="px-3 py-3">{t.table.project}</th>
                <th className="px-3 py-3">{t.table.target}</th>
                <th className="px-3 py-3">{t.table.remote}</th>
                <th className="px-3 py-3">{t.table.secret}</th>
                <th className="px-3 py-3">{t.table.lastRun}</th>
                <th className="px-3 py-3">{t.table.status}</th>
                <th className="px-5 py-3 text-right">{t.table.actions}</th>
              </tr>
            </thead>
            <tbody>
              {visibleSources.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-surface-400">
                    {t.table.noSources}
                  </td>
                </tr>
              )}
              {visibleSources.map((entry) => {
                const revealed = revealedId === entry.id;
                const secret = entry.kind === 'git-local' ? entry.authToken : entry.p4Passwd;
                const target = entry.kind === 'git-local'
                  ? entry.repoPath ?? '(auto)'
                  : entry.depotPath ?? '//...';
                const remote = entry.kind === 'git-local'
                  ? entry.remoteUrl ?? t.localOnly
                  : entry.p4Port ?? t.inheritEnv;
                const subline = entry.kind === 'git-local'
                  ? entry.branch ? `${t.branchPrefix} ${entry.branch}` : `${t.branchPrefix} main`
                  : entry.p4User ? `${t.userPrefix} ${entry.p4User}` : '';
                const disabled = !entry.enabled;
                const latestRun = entry.latestRun;
                const running = latestRun?.status === 'running';
                const pending = entry.enabled && !latestRun && !entry.lastError;
                const runStats = latestRun
                  ? `${latestRun.itemsImported}/${latestRun.itemsSeen} ${t.runStatsImported}, ${entry.failedCount} ${t.runStatsFailed}`
                  : '';
                return (
                  <tr key={entry.id} className="border-t border-surface-100 align-middle hover:bg-surface-50">
                    <td className="px-5 py-3">
                      {entry.kind === 'git-local' ? (
                        <span className="kind-pill kind-git inline-flex items-center gap-1">
                          <Icon icon="lucide:git-branch" className="text-xs" />git
                        </span>
                      ) : (
                        <span className="kind-pill kind-p4 inline-flex items-center gap-1">
                          <Icon icon="lucide:database" className="text-xs" />p4
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <p className={`text-sm font-semibold tracking-tight truncate ${disabled ? 'text-surface-500' : 'text-surface-800'}`}>
                        {entry.name}
                      </p>
                      {entry.lastError ? (
                        <button
                          type="button"
                          onClick={() => setErrorDetailId(errorDetailId === entry.id ? null : entry.id)}
                          className="text-[11px] text-red-500 font-medium truncate flex items-center gap-1 hover:underline"
                          title={t.viewErrorDetail}
                        >
                          <Icon icon="lucide:alert-triangle" className="text-[11px]" />
                          {truncate(entry.lastError, 32)}
                          <Icon icon={errorDetailId === entry.id ? 'lucide:chevron-up' : 'lucide:chevron-down'} className="text-[11px]" />
                        </button>
                      ) : subline ? (
                        <p className="text-[11px] text-surface-400 font-medium truncate font-mono">{subline}</p>
                      ) : null}
                      {errorDetailId === entry.id && entry.lastError && (
                        <pre className="mt-2 max-w-[420px] whitespace-pre-wrap break-words rounded-lg bg-red-50 border border-red-100 p-2.5 text-[11px] font-mono text-red-700">
                          {entry.latestRun?.error ?? entry.lastError}
                        </pre>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`project-tag ${disabled ? 'opacity-60' : ''}`}>{entry.project}</span>
                    </td>
                    <td className="px-3 py-3 mono-path truncate max-w-[220px]" title={target}>
                      <span className="font-mono text-[11px] text-surface-600">{truncate(target, 28)}</span>
                    </td>
                    <td className="px-3 py-3 max-w-[200px]" title={typeof remote === 'string' ? remote : ''}>
                      {entry.kind === 'git-local' && !entry.remoteUrl ? (
                        <span className="text-surface-400 italic text-xs">{t.localOnly}</span>
                      ) : (
                        <span className="font-mono text-[11px] text-surface-600 truncate block">{truncate(remote, 28)}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {!secret ? (
                        <span className="text-surface-400 italic text-xs">{t.none}</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="key-mask font-mono text-xs text-surface-600">
                            {revealed ? truncate(secret, 16) : '••••••••'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setRevealedId(revealed ? null : entry.id)}
                            className="reveal-btn w-6 h-6 flex items-center justify-center rounded-md text-surface-400 hover:text-brand-600"
                            title={revealed ? t.hide : t.reveal}
                          >
                            <Icon icon={revealed ? 'lucide:eye-off' : 'lucide:eye'} className="text-xs" />
                          </button>
                          {revealed && (
                            <button
                              type="button"
                              onClick={() => navigator.clipboard?.writeText(secret)}
                              className="reveal-btn w-6 h-6 flex items-center justify-center rounded-md text-surface-400 hover:text-brand-600"
                              title={t.copy}
                            >
                              <Icon icon="lucide:copy" className="text-xs" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className={`px-3 py-3 text-xs font-medium ${entry.lastError ? 'text-red-500' : 'text-surface-600'}`}>
                      <div>{timeAgo(entry.lastRunAt, t)}</div>
                      {runStats && <div className="text-[10px] text-surface-400 font-mono mt-0.5">{runStats}</div>}
                    </td>
                    <td className="px-3 py-3">
                      {entry.lastError ? (
                        <span className="status-pill status-error inline-flex items-center gap-1">
                          <span className="status-dot" />{t.statusError}
                        </span>
                      ) : running ? (
                        <span className="status-pill status-on inline-flex items-center gap-1">
                          <span className="status-dot animate-pulse" />{t.statusRunning}
                        </span>
                      ) : pending ? (
                        <span className="status-pill status-off inline-flex items-center gap-1" title={t.statusPendingHint}>
                          <span className="status-dot" />{t.statusPending}
                        </span>
                      ) : entry.enabled ? (
                        <span className="status-pill status-on inline-flex items-center gap-1">
                          <span className="status-dot" />{t.statusOn}
                        </span>
                      ) : (
                        <span className="status-pill status-off inline-flex items-center gap-1">
                          <span className="status-dot" />{t.statusOff}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Toggle
                          checked={entry.enabled}
                          onChange={() => toggleEnabled(entry)}
                          title={entry.enabled ? tAll.common.disable : tAll.common.enable}
                        />
                        <button
                          type="button"
                          onClick={() => openEdit(entry)}
                          className="action-btn w-7 h-7 flex items-center justify-center rounded-md text-surface-400 hover:text-surface-700"
                          title={t.edit}
                        >
                          <Icon icon="lucide:pencil" className="text-sm" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry)}
                          className="action-btn delete w-7 h-7 flex items-center justify-center rounded-md text-surface-400 hover:text-red-600"
                          title={t.delete}
                        >
                          <Icon icon="lucide:trash-2" className="text-sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 anim-in d5 flex-wrap gap-2">
        <p className="text-xs text-surface-400 font-medium flex items-center gap-1">
          <Icon icon="lucide:info" className="text-xs" />
          {t.credsFooter}
          <span className="font-mono ml-1">P4PORT</span> /
          <span className="font-mono">P4USER</span> /
          <span className="font-mono">P4PASSWD</span> {t.envVarsSuffix}
        </p>
        <p className="text-xs text-surface-400 font-medium">
          {t.showing} <span className="text-surface-700 font-semibold">{visibleSources.length}</span> {visibleSources.length === 1 ? t.sourceSingular : t.sourcePlural}
        </p>
      </div>
    </div>
  );
}

function byCreatedAt(a: ScannerSourceView, b: ScannerSourceView): number {
  return a.createdAt.localeCompare(b.createdAt);
}

function SummaryPill({ label, value, dotColor }: { label: string; value: number; dotColor?: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-surface-200 rounded-lg">
      {dotColor && <div className={`w-2 h-2 rounded-full ${dotColor}`} />}
      <span className="text-xs font-semibold text-surface-400">{label}</span>
      <span className="text-sm font-bold text-surface-800">{value}</span>
    </div>
  );
}

function KindTab({
  selected,
  icon,
  iconClass,
  title,
  desc,
  disabled,
  onClick,
}: {
  selected: boolean;
  icon: string;
  iconClass: string;
  title: string;
  desc: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border-[1.5px] text-left transition-colors ${
        selected
          ? 'border-brand-500 bg-brand-50'
          : 'border-surface-200 bg-white hover:border-brand-200 hover:bg-brand-50/40'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <Icon icon={icon} className={`text-xl ${iconClass}`} />
      <div>
        <p className={`text-sm font-bold tracking-tight ${selected ? 'text-brand-700' : 'text-surface-700'}`}>{title}</p>
        <p className={`text-[11px] font-medium ${selected ? 'text-brand-500' : 'text-surface-400'}`}>{desc}</p>
      </div>
    </button>
  );
}

function Field({
  label,
  suffixLabel,
  icon,
  colSpan,
  hint,
  children,
}: {
  label: string;
  suffixLabel?: string;
  icon: string;
  colSpan?: 1 | 2;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={colSpan === 2 ? 'col-span-2' : ''}>
      <label className="block text-[11px] font-bold text-surface-400 uppercase tracking-wider mb-1.5">
        {label}
        {suffixLabel && (
          <span className="font-medium normal-case tracking-normal text-surface-400 ml-1">{suffixLabel}</span>
        )}
      </label>
      <div className="input-field flex items-center rounded-lg bg-surface-50 border border-surface-200 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
        <div className="pl-3 py-2.5">
          <Icon icon={icon} className="text-surface-400 text-sm" />
        </div>
        {children}
      </div>
      {hint && <p className="text-[10px] text-surface-400 mt-1 ml-1">{hint}</p>}
    </div>
  );
}
