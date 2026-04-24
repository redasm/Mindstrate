import Link from 'next/link';
import { getMemoryReady } from '@/lib/memory';
import { getTypeInfo, getStatusInfo } from '@/lib/constants';
import { detectLocale } from '@/lib/i18n/index';
import { getTranslations } from '@/lib/i18n/translations';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const locale = detectLocale();
  const t = getTranslations(locale);
  const memory = await getMemoryReady();
  const stats = await memory.getStats();
  const recent = memory.readGraphKnowledge({ limit: 5 });

  const statCards = [
    { label: t.dashboard.totalKnowledge, value: stats.total, color: 'text-brand-600' },
    { label: t.dashboard.vectorIndex, value: stats.vectorCount, color: 'text-indigo-600' },
    {
      label: t.dashboard.languages,
      value: Object.keys(stats.byLanguage).length,
      color: 'text-green-600',
    },
    {
      label: t.dashboard.typesCount,
      value: Object.keys(stats.byType).length,
      color: 'text-purple-600',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t.dashboard.title}</h1>
        <p className="text-gray-500 mt-1">{t.dashboard.description}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(s => (
          <div key={s.label} className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm text-gray-500">{s.label}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Distribution */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* By Type */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900 mb-3">{t.dashboard.byType}</h2>
          {Object.keys(stats.byType).length === 0 ? (
            <p className="text-sm text-gray-400">{t.dashboard.noData}</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(stats.byType).map(([type, count]) => {
                const info = getTypeInfo(type, locale);
                return (
                  <div key={type} className="flex items-center justify-between">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${info.color}`}>
                      {info.label}
                    </span>
                    <span className="text-sm font-medium text-gray-700">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* By Status */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900 mb-3">{t.dashboard.byStatus}</h2>
          {Object.keys(stats.byStatus).length === 0 ? (
            <p className="text-sm text-gray-400">{t.dashboard.noData}</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(stats.byStatus).map(([status, count]) => {
                const info = getStatusInfo(status, locale);
                return (
                  <div key={status} className="flex items-center justify-between">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${info.color}`}>
                      {info.label}
                    </span>
                    <span className="text-sm font-medium text-gray-700">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* By Language */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900 mb-3">{t.dashboard.byLanguage}</h2>
          {Object.keys(stats.byLanguage).length === 0 ? (
            <p className="text-sm text-gray-400">{t.dashboard.noData}</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(stats.byLanguage).map(([lang, count]) => (
                <div key={lang} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{lang}</span>
                  <span className="text-sm font-medium text-gray-700">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Knowledge */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">{t.dashboard.recentKnowledge}</h2>
          <Link href="/knowledge" className="text-sm text-brand-600 hover:text-brand-700">
            {t.dashboard.viewAll}
          </Link>
        </div>

        {recent.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <p>{t.dashboard.noEntries}</p>
            <Link href="/knowledge/new" className="text-brand-600 hover:underline text-sm mt-2 inline-block">
              {t.dashboard.addFirst}
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recent.map(k => {
              const typeInfo = getTypeInfo(k.domainType, locale);
              return (
                <Link key={k.id} href={`/knowledge/${k.id}`} className="block py-3 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                    <span className="font-medium text-gray-900 text-sm truncate">{k.title}</span>
                    <span className="ml-auto text-xs text-gray-400 flex-shrink-0">{k.substrateType}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
