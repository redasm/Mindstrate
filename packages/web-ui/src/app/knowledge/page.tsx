'use client';

import { useEffect, useState, useCallback } from 'react';
import { KnowledgeCard } from '@/components/KnowledgeCard';
import Link from 'next/link';
import { getTypeFilterOptions } from '@/lib/constants';
import { useTranslations, useLocale } from '@/lib/i18n/hooks';

export default function KnowledgeListPage() {
  const t = useTranslations();
  const locale = useLocale();
  const TYPES = getTypeFilterOptions(locale);

  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (typeFilter) params.set('type', typeFilter);
    params.set('limit', '100');

    const res = await fetch(`/api/knowledge?${params}`);
    if (res.ok) {
      const data = await res.json();
      setEntries(data.entries || []);
    }
    setLoading(false);
  }, [typeFilter]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleDelete = async (id: string) => {
    if (!confirm(t.knowledgeList.confirmDelete)) return;
    await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
    fetchEntries();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t.knowledgeList.title}</h1>
        <Link
          href="/knowledge/new"
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          {t.knowledgeList.addBtn}
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">{t.knowledgeList.loading}</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p>{t.knowledgeList.noEntries}</p>
          <Link href="/knowledge/new" className="text-brand-600 hover:underline text-sm mt-2 inline-block">
            {t.knowledgeList.addFirst}
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((k: any) => (
            <KnowledgeCard
              key={k.id}
              knowledge={k}
              showActions
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
