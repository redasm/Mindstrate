'use client';

import { useMemo, useState } from 'react';
import type { ProjectLlmConfig, CreateLlmConfigInput, UpdateLlmConfigInput } from '@mindstrate/protocol';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';
import type { Translations } from '@/lib/i18n/en';

interface Props {
  initialConfigs: ProjectLlmConfig[];
  knownProjects: string[];
}

interface FormState {
  project: string;
  openaiApiKey: string;
  llmBaseUrl: string;
  embeddingBaseUrl: string;
  llmModel: string;
  embeddingModel: string;
  embeddingDim: number;
}

const blankForm = (): FormState => ({
  project: '',
  openaiApiKey: '',
  llmBaseUrl: '',
  embeddingBaseUrl: '',
  llmModel: '',
  embeddingModel: '',
  embeddingDim: 1536,
});

const EMBEDDING_DIM_PRESETS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'text-embedding-v3': 1024,
  'text-embedding-v2': 1536,
  'text-embedding-v1': 1536,
  'bge-large-zh-v1.5': 1024,
  'bge-m3': 1024,
  'nomic-embed-text': 768,
};

function timeAgo(iso: string | undefined, t: Translations['llmConfigs']): string {
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

function truncate(value: string | undefined, max = 32): string {
  if (!value) return '—';
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function LlmConfigsClient({ initialConfigs, knownProjects }: Props) {
  const tAll = useTranslations();
  const t = tAll.llmConfigs;
  const [configs, setConfigs] = useState<ProjectLlmConfig[]>(initialConfigs);
  const [showPanel, setShowPanel] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const counts = useMemo(() => {
    const projects = new Set(configs.map((c) => c.project));
    return { total: configs.length, projects: projects.size };
  }, [configs]);

  const setFormField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onEmbeddingModelChange = (value: string) => {
    const trimmed = value.trim();
    const preset = EMBEDDING_DIM_PRESETS[trimmed];
    setForm((prev) => ({
      ...prev,
      embeddingModel: value,
      embeddingDim: preset ?? prev.embeddingDim,
    }));
  };

  const resetForm = () => {
    setForm(blankForm());
    setEditingId(null);
    setError(null);
    setShowApiKey(false);
  };

  const closePanel = () => {
    setShowPanel(false);
    resetForm();
  };

  const openCreate = () => {
    resetForm();
    setShowPanel(true);
  };

  const openEdit = async (config: ProjectLlmConfig) => {
    setEditingId(config.id);
    setError(null);
    setShowApiKey(false);
    const res = await fetch(`/api/admin/llm-configs/${encodeURIComponent(config.id)}`);
    if (!res.ok) {
      setError(`${t.loadFailedPrefix} (${res.status})`);
      return;
    }
    const full = (await res.json()) as ProjectLlmConfig;
    setForm({
      project: full.project,
      openaiApiKey: full.openaiApiKey,
      llmBaseUrl: full.llmBaseUrl ?? '',
      embeddingBaseUrl: full.embeddingBaseUrl ?? '',
      llmModel: full.llmModel,
      embeddingModel: full.embeddingModel,
      embeddingDim: full.embeddingDim,
    });
    setShowPanel(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!form.project.trim()) {
      setError(t.projectRequired);
      return;
    }
    if (!editingId && !form.openaiApiKey.trim()) {
      setError(t.apiKeyRequired);
      return;
    }
    if (!form.llmModel.trim() || !form.embeddingModel.trim()) {
      setError(t.modelsRequired);
      return;
    }
    if (!Number.isInteger(form.embeddingDim) || form.embeddingDim <= 0) {
      setError(t.dimRequired);
      return;
    }

    setSubmitting(true);
    let res: Response;
    if (editingId) {
      const patch: UpdateLlmConfigInput = {
        llmBaseUrl: form.llmBaseUrl.trim() === '' ? null : form.llmBaseUrl.trim(),
        embeddingBaseUrl: form.embeddingBaseUrl.trim() === '' ? null : form.embeddingBaseUrl.trim(),
        llmModel: form.llmModel.trim(),
        embeddingModel: form.embeddingModel.trim(),
        embeddingDim: form.embeddingDim,
      };
      if (form.openaiApiKey.trim() !== '' && !form.openaiApiKey.startsWith('••••')) {
        patch.openaiApiKey = form.openaiApiKey.trim();
      }
      res = await fetch(`/api/admin/llm-configs/${encodeURIComponent(editingId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } else {
      const payload: CreateLlmConfigInput = {
        project: form.project.trim(),
        openaiApiKey: form.openaiApiKey.trim(),
        llmBaseUrl: form.llmBaseUrl.trim() || undefined,
        embeddingBaseUrl: form.embeddingBaseUrl.trim() || undefined,
        llmModel: form.llmModel.trim(),
        embeddingModel: form.embeddingModel.trim(),
        embeddingDim: form.embeddingDim,
      };
      res = await fetch('/api/admin/llm-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `${t.saveFailedPrefix} (${res.status})`);
      return;
    }
    const saved = (await res.json()) as ProjectLlmConfig;
    setConfigs((prev) => {
      const filtered = prev.filter((entry) => entry.id !== saved.id);
      return editingId ? [...filtered, saved].sort(byProject) : [saved, ...filtered];
    });
    closePanel();
  };

  const handleDelete = async (config: ProjectLlmConfig) => {
    if (!confirm(t.deleteConfirm.replace('{PROJECT}', config.project))) return;
    const res = await fetch(`/api/admin/llm-configs/${encodeURIComponent(config.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `${t.deleteFailedPrefix} (${res.status})`);
      return;
    }
    setConfigs((prev) => prev.filter((entry) => entry.id !== config.id));
    if (editingId === config.id) closePanel();
  };

  const revealKey = async (config: ProjectLlmConfig) => {
    if (revealedId === config.id) {
      setRevealedId(null);
      setRevealedKey(null);
      return;
    }
    const res = await fetch(`/api/admin/llm-configs/${encodeURIComponent(config.id)}`);
    if (!res.ok) {
      setError(`${t.loadFailedPrefix} (${res.status})`);
      return;
    }
    const full = (await res.json()) as ProjectLlmConfig;
    setRevealedId(config.id);
    setRevealedKey(full.openaiApiKey);
  };

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-5">
      <div className="flex items-end justify-between mb-6 anim-in d1 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-surface-900 mb-1">{t.title}</h1>
          <p className="text-sm text-surface-500 font-medium">{t.description}</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Icon icon="lucide:plus-circle" className="text-sm" />
          {t.addConfig}
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5 anim-in d2 flex-wrap">
        <SummaryPill label={t.summaryTotal} value={counts.total} />
        <SummaryPill label={t.summaryProjects} value={counts.projects} dotColor="bg-brand-400" />
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-2.5 px-3.5 py-2.5 bg-red-50 border border-red-100 rounded-xl">
          <Icon icon="lucide:alert-circle" className="text-red-500 text-base" />
          <span className="text-sm font-medium text-red-700">{error}</span>
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
                <Icon icon="lucide:brain-circuit" className="text-lg text-brand-500" />
              </div>
              <div>
                <h2 className="text-base font-bold tracking-tight text-surface-900">
                  {editingId ? t.panelEdit : t.panelAdd}
                </h2>
                <p className="text-xs text-surface-400 font-medium">{t.panelSubtitle}</p>
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
            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              <Field label={t.project} icon="lucide:folder">
                <input
                  type="text"
                  list="llm-known-projects"
                  value={form.project}
                  onChange={(e) => setFormField('project', e.target.value)}
                  placeholder={t.projectPlaceholder}
                  disabled={!!editingId}
                  className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-medium text-surface-800 placeholder-surface-400 outline-none disabled:opacity-60"
                />
                <datalist id="llm-known-projects">
                  {knownProjects.map((p) => <option key={p} value={p} />)}
                </datalist>
              </Field>
              <Field
                label={t.apiKey}
                suffixLabel={editingId ? t.apiKeyEditSuffix : t.apiKeyCreateSuffix}
                icon="lucide:key-round"
              >
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={form.openaiApiKey}
                  onChange={(e) => setFormField('openaiApiKey', e.target.value)}
                  placeholder={t.apiKeyPlaceholder}
                  className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="reveal-btn mr-2 p-1.5 rounded-lg text-surface-400"
                  title={showApiKey ? t.hide : t.reveal}
                >
                  <Icon icon={showApiKey ? 'lucide:eye-off' : 'lucide:eye'} className="text-sm" />
                </button>
              </Field>

              <Field label={t.llmBaseUrl} suffixLabel={t.optional} icon="lucide:link" colSpan={2}>
                <input
                  type="text"
                  value={form.llmBaseUrl}
                  onChange={(e) => setFormField('llmBaseUrl', e.target.value)}
                  placeholder={t.llmBaseUrlPlaceholder}
                  className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                />
              </Field>
              <Field
                label={t.embeddingBaseUrl}
                suffixLabel={t.embeddingBaseUrlSuffix}
                icon="lucide:link-2"
                colSpan={2}
              >
                <input
                  type="text"
                  value={form.embeddingBaseUrl}
                  onChange={(e) => setFormField('embeddingBaseUrl', e.target.value)}
                  placeholder={t.embeddingBaseUrlPlaceholder}
                  className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                />
              </Field>

              <Field label={t.llmModel} icon="lucide:cpu">
                <input
                  type="text"
                  value={form.llmModel}
                  onChange={(e) => setFormField('llmModel', e.target.value)}
                  placeholder={t.llmModelPlaceholder}
                  className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                />
              </Field>
              <Field label={t.embeddingModel} icon="lucide:waves">
                <input
                  type="text"
                  value={form.embeddingModel}
                  onChange={(e) => onEmbeddingModelChange(e.target.value)}
                  placeholder={t.embeddingModelPlaceholder}
                  className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 placeholder-surface-400 outline-none"
                />
              </Field>

              <Field
                label={t.embeddingDim}
                suffixLabel={t.embeddingDimSuffix}
                icon="lucide:ruler"
                hint={t.embeddingDimHint}
                colSpan={2}
              >
                <input
                  type="number"
                  min={1}
                  value={form.embeddingDim}
                  onChange={(e) => setFormField('embeddingDim', Number(e.target.value))}
                  className="flex-1 px-2.5 py-2.5 bg-transparent text-sm font-mono text-surface-800 outline-none max-w-[200px]"
                />
              </Field>
            </div>
          </div>

          <div className="px-5 py-4 border-t border-surface-100 bg-surface-50 flex items-center justify-between rounded-b-2xl gap-3 flex-wrap">
            <div className="flex items-start gap-2 text-xs text-surface-500">
              <Icon icon="lucide:info" className="text-sm text-surface-400 mt-0.5" />
              <span className="font-medium">{t.credsNote}</span>
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
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="bg-surface-50 text-left text-[11px] font-bold text-surface-400 uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3">{t.table.project}</th>
                <th className="px-3 py-3">{t.table.llmModel}</th>
                <th className="px-3 py-3">{t.table.embeddingModel}</th>
                <th className="px-3 py-3">{t.table.dim}</th>
                <th className="px-3 py-3">{t.table.baseUrl}</th>
                <th className="px-3 py-3">{t.table.apiKey}</th>
                <th className="px-3 py-3">{t.table.updated}</th>
                <th className="px-5 py-3 text-right">{t.table.actions}</th>
              </tr>
            </thead>
            <tbody>
              {configs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-surface-400">
                    {t.table.noConfigs}
                  </td>
                </tr>
              )}
              {configs.map((entry) => {
                const revealed = revealedId === entry.id;
                const displayKey = revealed && revealedKey ? revealedKey : entry.openaiApiKey;
                return (
                  <tr key={entry.id} className="border-t border-surface-100 align-middle hover:bg-surface-50">
                    <td className="px-5 py-3">
                      <span className="project-tag">{entry.project}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-[12px] text-surface-700">{entry.llmModel}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-[12px] text-surface-700">{entry.embeddingModel}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-[11px] text-surface-600">{entry.embeddingDim}</span>
                    </td>
                    <td className="px-3 py-3 max-w-[220px]" title={entry.llmBaseUrl ?? ''}>
                      {entry.llmBaseUrl ? (
                        <span className="font-mono text-[11px] text-surface-600 truncate block">
                          {truncate(entry.llmBaseUrl, 32)}
                        </span>
                      ) : (
                        <span className="text-surface-400 italic text-xs">{t.openaiDefault}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="key-mask font-mono text-xs text-surface-600">
                          {revealed ? truncate(displayKey, 18) : entry.openaiApiKey}
                        </span>
                        <button
                          type="button"
                          onClick={() => revealKey(entry)}
                          className="reveal-btn w-6 h-6 flex items-center justify-center rounded-md text-surface-400 hover:text-brand-600"
                          title={revealed ? t.hide : t.reveal}
                        >
                          <Icon icon={revealed ? 'lucide:eye-off' : 'lucide:eye'} className="text-xs" />
                        </button>
                        {revealed && revealedKey && (
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(revealedKey)}
                            className="reveal-btn w-6 h-6 flex items-center justify-center rounded-md text-surface-400 hover:text-brand-600"
                            title={t.copy}
                          >
                            <Icon icon="lucide:copy" className="text-xs" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs font-medium text-surface-600">
                      {timeAgo(entry.updatedAt, t)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(entry)}
                          className="action-btn w-7 h-7 flex items-center justify-center rounded-md text-surface-400 hover:text-surface-700"
                          title={tAll.common.edit}
                        >
                          <Icon icon="lucide:pencil" className="text-sm" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(entry)}
                          className="action-btn delete w-7 h-7 flex items-center justify-center rounded-md text-surface-400 hover:text-red-600"
                          title={tAll.common.delete}
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
          {t.offlineFallback}
        </p>
        <p className="text-xs text-surface-400 font-medium">
          {t.showing} <span className="text-surface-700 font-semibold">{configs.length}</span>{' '}
          {configs.length === 1 ? t.configSingular : t.configPlural}
        </p>
      </div>
    </div>
  );
}

function byProject(a: ProjectLlmConfig, b: ProjectLlmConfig): number {
  return a.project.localeCompare(b.project);
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
