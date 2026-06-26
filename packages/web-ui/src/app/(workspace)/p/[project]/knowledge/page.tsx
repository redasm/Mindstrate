'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import { Icon } from '@/components/ui/Icon';
import { KnowledgeCard, type KnowledgeCardData } from '@/components/KnowledgeCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { useTranslations } from '@/lib/i18n/hooks';

type ApiEntry = {
  id: string;
  title: string;
  summary?: string;
  solution?: string;
  substrateType?: string;
  type?: string;
  context?: { project?: string; language?: string };
  tags?: string[];
  updatedAt?: string;
  refCount?: number;
};

const PAGE_SIZE = 12;

export default function ProjectKnowledgePage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = use(params);
  const decoded = decodeURIComponent(project);
  const router = useRouter();
  const tAll = useTranslations();
  const t = tAll.knowledge;
  const [entries, setEntries] = useState<KnowledgeCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [langFilter, setLangFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // No limit param → the API returns the project's full knowledge set.
      // The list is client-side paginated below, so rendering all is fine, and
      // the count never silently caps at a hard-coded number.
      const qs = new URLSearchParams({ project: decoded });
      const resp = await fetch(`/api/knowledge?${qs}`);
      if (!resp.ok) {
        setEntries([]);
        return;
      }
      const data = await resp.json();
      const list: KnowledgeCardData[] = (data.entries ?? []).map((e: ApiEntry) => ({
        id: e.id,
        title: e.title,
        summary: e.summary ?? e.solution ?? '',
        substrateType: e.substrateType ?? e.type ?? 'rule',
        context: e.context,
        tags: e.tags,
        updatedAt: e.updatedAt,
        refCount: e.refCount,
      }));
      setEntries(list);
    } finally {
      setLoading(false);
    }
  }, [decoded]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter && e.substrateType.toLowerCase() !== typeFilter) return false;
      if (langFilter && (e.context?.language ?? '').toLowerCase() !== langFilter) return false;
      if (q && !(e.title.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [entries, typeFilter, langFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [typeFilter, langFilter, search]);

  const handleDelete = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    await fetch(`/api/knowledge/${encodeURIComponent(id)}`, { method: 'DELETE' });
    void load();
  };

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

      <div className="flex items-center justify-between gap-4 mb-5 anim-in d2">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-sm font-medium text-surface-700 bg-white border border-surface-200 rounded-lg cursor-pointer outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">{t.filterAll}</option>
              <option value="pattern">{t.typePattern}</option>
              <option value="rule">{t.typeRule}</option>
              <option value="summary">{t.typeSummary}</option>
              <option value="skill">{t.typeSkill}</option>
              <option value="snapshot">{t.typeSnapshot}</option>
            </select>
            <Icon
              icon="lucide:chevron-down"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-surface-400 pointer-events-none"
            />
          </div>
          <div className="relative">
            <select
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-sm font-medium text-surface-700 bg-white border border-surface-200 rounded-lg cursor-pointer outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">{t.allLanguages}</option>
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="go">Go</option>
              <option value="rust">Rust</option>
            </select>
            <Icon
              icon="lucide:chevron-down"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-surface-400 pointer-events-none"
            />
          </div>
          <div className="relative">
            <Icon
              icon="lucide:search"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-surface-400"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-56 pl-9 pr-3 py-2 text-sm font-medium text-surface-700 bg-white border border-surface-200 rounded-lg outline-none transition-all placeholder-surface-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-surface-400">
            <span className="text-surface-700 font-semibold">{filtered.length}</span> {t.entriesLabel}
          </span>
          <button
            type="button"
            onClick={() => router.push(`/p/${encodeURIComponent(decoded)}/knowledge/new`)}
            className="btn-primary inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold"
          >
            <Icon icon="lucide:plus" className="text-sm" />
            {t.addEntry}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-sm text-surface-400">{t.loading}</div>
      ) : pageItems.length === 0 ? (
        <EmptyState
          icon="lucide:inbox"
          title={t.noEntriesTitle}
          description={
            entries.length === 0
              ? t.noEntriesEmpty
              : t.noEntriesFiltered
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
            {pageItems.map((k, i) => (
              <div key={k.id} className={`anim-in d${Math.min(i + 1, 8)}`}>
                <KnowledgeCard
                  knowledge={k}
                  href={`/p/${encodeURIComponent(decoded)}/knowledge/${encodeURIComponent(k.id)}`}
                  onDelete={handleDelete}
                />
              </div>
            ))}
          </div>
          <div className="anim-in d8 flex items-center justify-between">
            <p className="text-sm text-surface-400 font-medium">
              {t.showing}{' '}
              <span className="text-surface-700 font-semibold">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}
              </span>{' '}
              {t.of} <span className="text-surface-700 font-semibold">{filtered.length}</span> {t.entriesLabel}
            </p>
            <Pagination page={page} totalPages={pageCount} onChange={setPage} />
          </div>
        </>
      )}

      <div className="h-6" />
    </div>
  );
}
