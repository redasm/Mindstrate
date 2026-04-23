'use client';

import { useState } from 'react';
import { KnowledgeCard } from '@/components/KnowledgeCard';
import { getTypeFilterOptions } from '@/lib/constants';
import { useTranslations, useLocale } from '@/lib/i18n/hooks';

export default function SearchPage() {
  const t = useTranslations();
  const locale = useLocale();
  const TYPES = getTypeFilterOptions(locale);

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [langFilter, setLangFilter] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          topK: 10,
          type: typeFilter || undefined,
          language: langFilter || undefined,
        }),
      });
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{t.search.title}</h1>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex gap-3">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t.search.placeholder}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {loading ? t.search.searching : t.search.searchBtn}
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mt-3">
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input
            value={langFilter}
            onChange={e => setLangFilter(e.target.value)}
            placeholder={t.search.langPlaceholder}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </form>

      {/* Results */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">{t.search.searching}</div>
      ) : searched && results.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p>{t.search.noResults} &ldquo;{query}&rdquo;</p>
          <p className="text-sm mt-1">{t.search.tryDifferent}</p>
        </div>
      ) : results.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">{results.length} {t.search.resultsFor} &ldquo;{query}&rdquo;</p>
          {results.map((r: any) => (
            <KnowledgeCard
              key={r.knowledge.id}
              knowledge={r.knowledge}
              relevance={r.relevanceScore}
            />
          ))}
        </div>
      ) : !searched ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">{t.search.welcomeTitle}</p>
          <p className="text-sm">{t.search.welcomeDesc}</p>
        </div>
      ) : null}
    </div>
  );
}
