'use client';

import { useState, use, useMemo, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';

export default function NewKnowledgePage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = use(params);
  const decoded = decodeURIComponent(project);
  const router = useRouter();
  const tAll = useTranslations();
  const t = tAll.addKnowledge;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    type: 'how_to',
    title: '',
    problem: '',
    solution: '',
    tags: '',
    language: '',
    framework: '',
  });

  const types = useMemo(
    () => [
      { value: 'how_to', label: t.typeHowTo },
      { value: 'rule', label: t.typeRule },
      { value: 'pattern', label: t.typePattern },
      { value: 'summary', label: t.typeSummary },
      { value: 'skill', label: t.typeSkill },
    ],
    [t],
  );

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.solution.trim()) {
      setError(t.titleSolutionRequired);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const resp = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          title: form.title.trim(),
          problem: form.problem.trim() || undefined,
          solution: form.solution.trim(),
          tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
          language: form.language.trim() || undefined,
          framework: form.framework.trim() || undefined,
          project: decoded,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        router.push(`/p/${encodeURIComponent(decoded)}/knowledge`);
      } else {
        setError(data.message || t.addFailed);
      }
    } catch {
      setError(t.networkError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-5">
      <div className="mb-5 anim-in d1">
        <Link
          href={`/p/${encodeURIComponent(decoded)}/knowledge`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-surface-500 hover:text-brand-600 transition-colors mb-3"
        >
          <Icon icon="lucide:arrow-left" className="text-sm" />
          {t.backTo} {decoded}
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-surface-900">{t.pageTitle}</h1>
        <p className="text-sm text-surface-500 font-medium">
          {t.pageDescription}{' '}
          <span className="font-semibold text-brand-600">{decoded}</span>.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="bg-white rounded-2xl border border-surface-200 p-6 space-y-5 anim-in d2"
      >
        {error && (
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-red-50 border border-red-100 rounded-xl">
            <Icon icon="lucide:alert-circle" className="text-red-500 text-base flex-shrink-0" />
            <span className="text-sm font-medium text-red-700">{error}</span>
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-surface-700 mb-1.5">{t.typeLabel}</label>
          <select
            value={form.type}
            onChange={set('type')}
            className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm font-medium text-surface-700 bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          >
            {types.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-surface-700 mb-1.5">
            {t.titleLabel} <span className="text-red-500">*</span>
          </label>
          <input
            value={form.title}
            onChange={set('title')}
            placeholder={t.titlePlaceholder}
            className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-surface-700 mb-1.5">
            {t.problemLabel} <span className="text-surface-400 font-normal">({t.optional})</span>
          </label>
          <textarea
            value={form.problem}
            onChange={set('problem')}
            placeholder={t.problemPlaceholder}
            rows={3}
            className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-surface-700 mb-1.5">
            {t.solutionLabel} <span className="text-red-500">*</span>
          </label>
          <textarea
            value={form.solution}
            onChange={set('solution')}
            placeholder={t.solutionPlaceholder}
            rows={8}
            className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-surface-700 mb-1.5">
            {t.tagsLabel} <span className="text-surface-400 font-normal">({t.commaSeparated})</span>
          </label>
          <input
            value={form.tags}
            onChange={set('tags')}
            placeholder={t.tagsPlaceholder}
            className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">{t.languageLabel}</label>
            <input
              value={form.language}
              onChange={set('language')}
              placeholder={t.languagePlaceholder}
              className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">{t.frameworkLabel}</label>
            <input
              value={form.framework}
              onChange={set('framework')}
              placeholder={t.frameworkPlaceholder}
              className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            href={`/p/${encodeURIComponent(decoded)}/knowledge`}
            className="btn-outline px-4 py-2 rounded-lg text-sm font-semibold"
          >
            {t.cancel}
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary px-5 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
          >
            {submitting ? t.adding : t.addBtn}
            {!submitting && <Icon icon="lucide:check" className="text-sm" />}
          </button>
        </div>
      </form>
    </div>
  );
}
