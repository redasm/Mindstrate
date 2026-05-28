'use client';

import { useCallback, useEffect, useMemo, useState, use } from 'react';
import { Icon } from '@/components/ui/Icon';
import { KnowledgeCard, type KnowledgeCardData } from '@/components/KnowledgeCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTranslations } from '@/lib/i18n/hooks';

type GraphEntry = {
  id: string;
  title: string;
  summary: string;
  substrateType: string;
  domainType?: string;
  project?: string;
  tags?: string[];
};

export default function ProjectGraphKnowledgePage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = use(params);
  const decoded = decodeURIComponent(project);
  const tAll = useTranslations();
  const t = tAll.graph;
  const tabs = useMemo(
    () => [
      { key: 'all', label: t.layerAll, icon: 'lucide:layers' },
      { key: 'rule', label: t.layerRules, icon: 'lucide:gavel' },
      { key: 'pattern', label: t.layerPatterns, icon: 'lucide:shapes' },
      { key: 'summary', label: t.layerSummaries, icon: 'lucide:file-text' },
      { key: 'high_order', label: t.layerHighOrder, icon: 'lucide:sparkles' },
    ],
    [t],
  );
  const [entries, setEntries] = useState<GraphEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    const resp = await fetch(`/api/graph-knowledge?limit=200&project=${encodeURIComponent(decoded)}`);
    if (resp.ok) {
      const data = await resp.json();
      setEntries(data.entries ?? []);
    } else {
      setEntries([]);
    }
    setLoading(false);
  }, [decoded]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (tab === 'all') return entries;
    return entries.filter((e) => e.substrateType.toLowerCase() === tab);
  }, [entries, tab]);

  const cards: KnowledgeCardData[] = visible.map((e) => ({
    id: e.id,
    title: e.title,
    summary: e.summary,
    substrateType: e.substrateType,
    tags: e.tags,
  }));

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-5">
      <div className="mb-5 anim-in d1">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold tracking-tight text-surface-900">{t.title}</h1>
          <span className="px-2 py-0.5 text-xs font-semibold text-brand-600 bg-brand-50 rounded-md border border-brand-100">
            {decoded}
          </span>
        </div>
        <p className="text-sm text-surface-500 font-medium">
          {t.description}
        </p>
      </div>

      <div className="flex items-center gap-1 mb-5 anim-in d2 border-b border-surface-200">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.key}
            type="button"
            onClick={() => setTab(tabItem.key)}
            className={`tab-link h-10 flex items-center px-3.5 text-sm font-medium ${tab === tabItem.key ? 'active' : ''}`}
          >
            <Icon icon={tabItem.icon} className="mr-1.5 text-sm" />
            {tabItem.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-sm text-surface-400">{t.loading}</div>
      ) : cards.length === 0 ? (
        <EmptyState icon="lucide:layers" title={t.noEntriesTitle} description={t.noEntriesDescription} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map((k, i) => (
            <div key={k.id} className={`anim-in d${Math.min(i + 1, 8)}`}>
              <KnowledgeCard knowledge={k} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
