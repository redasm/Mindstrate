import type { Locale } from './i18n/index';
import { getTranslations } from './i18n/translations';

/** Color mappings for knowledge types (locale-independent) */
export const TYPE_COLORS: Record<string, string> = {
  bug_fix:         'bg-red-100 text-red-800',
  best_practice:   'bg-green-100 text-green-800',
  architecture:    'bg-purple-100 text-purple-800',
  convention:      'bg-blue-100 text-blue-800',
  pattern:         'bg-indigo-100 text-indigo-800',
  troubleshooting: 'bg-orange-100 text-orange-800',
  gotcha:          'bg-yellow-100 text-yellow-800',
  how_to:          'bg-cyan-100 text-cyan-800',
  workflow:        'bg-teal-100 text-teal-800',
};

/** Color mappings for knowledge statuses (locale-independent) */
export const STATUS_COLORS: Record<string, string> = {
  probation:  'bg-gray-100 text-gray-700',
  active:     'bg-green-100 text-green-700',
  verified:   'bg-blue-100 text-blue-700',
  outdated:   'bg-yellow-100 text-yellow-700',
};

/** Get localized type label + color */
export function getTypeInfo(type: string, locale: Locale): { label: string; color: string } {
  const t = getTranslations(locale);
  return {
    label: t.types[type] ?? type,
    color: TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-800',
  };
}

/** Get localized status label + color */
export function getStatusInfo(status: string, locale: Locale): { label: string; color: string } {
  const t = getTranslations(locale);
  return {
    label: t.statuses[status] ?? status,
    color: STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-700',
  };
}

/** Get the type filter options list (localized) */
export function getTypeFilterOptions(locale: Locale): Array<{ value: string; label: string }> {
  const t = getTranslations(locale);
  return [
    { value: '', label: t.typeFilter.all },
    ...Object.entries(t.types).map(([value, label]) => ({ value, label })),
  ];
}

/** Format a date string according to locale */
export function formatDate(iso: string, locale: Locale = 'en'): string {
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US';
  return new Date(iso).toLocaleDateString(dateLocale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
