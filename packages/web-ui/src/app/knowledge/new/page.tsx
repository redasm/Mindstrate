'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getTypeFilterOptions } from '@/lib/constants';
import { useTranslations, useLocale } from '@/lib/i18n/hooks';

export default function AddKnowledgePage() {
  const t = useTranslations();
  const locale = useLocale();
  // Reuse the type options but remove the "All Types" entry
  const TYPES = getTypeFilterOptions(locale).filter(opt => opt.value !== '');

  const router = useRouter();
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
    project: '',
    author: '',
  });

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.solution.trim()) {
      setError(t.addKnowledge.titleSolutionRequired);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          title: form.title.trim(),
          problem: form.problem.trim() || undefined,
          solution: form.solution.trim(),
          tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
          language: form.language.trim() || undefined,
          framework: form.framework.trim() || undefined,
          project: form.project.trim() || undefined,
          author: form.author.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        router.push(`/knowledge/${data.view.id}`);
      } else {
        setError(data.message || t.addKnowledge.addFailed);
      }
    } catch (err) {
      setError(t.addKnowledge.networkError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t.addKnowledge.title}</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
        )}

        {/* Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t.addKnowledge.typeLabel} {t.addKnowledge.required}</label>
          <select value={form.type} onChange={set('type')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            {TYPES.map(tp => <option key={tp.value} value={tp.value}>{tp.label}</option>)}
          </select>
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t.addKnowledge.titleLabel} {t.addKnowledge.required}</label>
          <input
            value={form.title} onChange={set('title')}
            placeholder={t.addKnowledge.titlePlaceholder}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Problem */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t.addKnowledge.problemLabel} <span className="text-gray-400">({t.addKnowledge.optional})</span></label>
          <textarea
            value={form.problem} onChange={set('problem')}
            placeholder={t.addKnowledge.problemPlaceholder}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Solution */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t.addKnowledge.solutionLabel} {t.addKnowledge.required}</label>
          <textarea
            value={form.solution} onChange={set('solution')}
            placeholder={t.addKnowledge.solutionPlaceholder}
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t.addKnowledge.tagsLabel} <span className="text-gray-400">({t.addKnowledge.commaSeparated})</span></label>
          <input
            value={form.tags} onChange={set('tags')}
            placeholder={t.addKnowledge.tagsPlaceholder}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Context grid */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.addKnowledge.languageLabel}</label>
            <input value={form.language} onChange={set('language')} placeholder="typescript" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.addKnowledge.frameworkLabel}</label>
            <input value={form.framework} onChange={set('framework')} placeholder="react" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.addKnowledge.projectLabel}</label>
            <input value={form.project} onChange={set('project')} placeholder="my-app" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.addKnowledge.authorLabel}</label>
            <input value={form.author} onChange={set('author')} placeholder="your-name" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? t.addKnowledge.adding : t.addKnowledge.addBtn}
        </button>
      </form>
    </div>
  );
}
