'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { KnowledgeTypePill } from '@/components/ui/Pill';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTranslations } from '@/lib/i18n/hooks';

interface KnowledgeDetail {
  id: string;
  title: string;
  summary: string;
  content: string;
  substrateType: string;
  domainType?: string;
  project?: string;
  status?: string;
  sourceRef?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export default function KnowledgeDetailPage({ params }: { params: Promise<{ project: string; id: string }> }) {
  const { project, id } = use(params);
  const decoded = decodeURIComponent(project);
  const listHref = `/p/${encodeURIComponent(decoded)}/knowledge`;
  const router = useRouter();
  const tAll = useTranslations();
  const t = tAll.knowledge;
  const [entry, setEntry] = useState<KnowledgeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/knowledge/${encodeURIComponent(id)}`);
      if (!resp.ok) {
        setMissing(true);
        return;
      }
      setEntry(await resp.json() as KnowledgeDetail);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!confirm(t.deleteConfirm)) return;
    const resp = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (resp.ok) router.push(listHref);
  };

  return (
    <div className="max-w-[860px] mx-auto px-6 py-5">
      <div className="mb-5 anim-in d1">
        <Link
          href={listHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-surface-500 hover:text-surface-700"
        >
          <Icon icon="lucide:arrow-left" className="text-sm" />
          {t.backToList}
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-16 text-sm text-surface-400">{t.loading}</div>
      ) : missing || !entry ? (
        <EmptyState icon="lucide:file-question" title={t.detailNotFoundTitle} description={t.detailNotFound} />
      ) : (
        <div className="bg-white rounded-2xl border border-surface-200 anim-in d2">
          <div className="px-6 py-5 border-b border-surface-100">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <KnowledgeTypePill type={entry.substrateType} />
                  {entry.domainType && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-surface-200 text-surface-500">
                      {entry.domainType}
                    </span>
                  )}
                  {entry.status && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-surface-200 text-surface-500">
                      {entry.status}
                    </span>
                  )}
                </div>
                <h1 className="text-lg font-bold text-surface-900 tracking-tight leading-snug break-words">
                  {entry.title}
                </h1>
              </div>
              <button
                type="button"
                onClick={handleDelete}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-200 text-sm font-medium text-surface-600 hover:text-red-600 hover:border-red-200"
              >
                <Icon icon="lucide:trash-2" className="text-sm" />
                {tAll.common.delete}
              </button>
            </div>
          </div>

          <div className="px-6 py-5">
            <pre className="whitespace-pre-wrap break-words text-sm text-surface-700 leading-relaxed font-sans">
              {entry.content}
            </pre>
          </div>

          <div className="px-6 py-4 border-t border-surface-100 grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-surface-500">
            {entry.project && (
              <span className="flex items-center gap-1.5">
                <Icon icon="lucide:folder" className="text-xs" />
                {entry.project}
              </span>
            )}
            {entry.sourceRef && (
              <span className="flex items-center gap-1.5 font-mono truncate" title={entry.sourceRef}>
                <Icon icon="lucide:link-2" className="text-xs shrink-0" />
                {entry.sourceRef}
              </span>
            )}
            {entry.createdAt && (
              <span className="flex items-center gap-1.5">
                <Icon icon="lucide:calendar-plus" className="text-xs" />
                {t.createdLabel} {new Date(entry.createdAt).toLocaleString()}
              </span>
            )}
            {entry.updatedAt && (
              <span className="flex items-center gap-1.5">
                <Icon icon="lucide:clock" className="text-xs" />
                {t.updatedLabel} {new Date(entry.updatedAt).toLocaleString()}
              </span>
            )}
            {entry.tags && entry.tags.length > 0 && (
              <span className="col-span-2 flex items-center gap-1.5 flex-wrap">
                <Icon icon="lucide:tags" className="text-xs" />
                {entry.tags.map((tag) => (
                  <span key={tag} className="px-1.5 py-0.5 rounded bg-surface-100 text-surface-600">{tag}</span>
                ))}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
