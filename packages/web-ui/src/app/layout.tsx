import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { detectLocale, getHtmlLang } from '@/lib/i18n/index';
import { getTranslations } from '@/lib/i18n/translations';
import { LocaleProvider } from '@/lib/i18n/provider';
import { NavLinks } from '@/components/NavLinks';

export const metadata: Metadata = {
  title: 'Mindstrate',
  description: 'AI memory and context substrate for agents and teams',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = detectLocale();
  const t = getTranslations(locale);

  const NAV_ITEMS = [
    { href: '/',               label: t.nav.dashboard },
    { href: '/knowledge',      label: t.nav.knowledge },
    { href: '/ecs',            label: 'ECS' },
    { href: '/graph-knowledge', label: 'Graph' },
    { href: '/search',         label: t.nav.search },
    { href: '/knowledge/new',  label: t.nav.add },
  ];

  return (
    <html lang={getHtmlLang(locale)}>
      <body className="bg-gray-50 min-h-screen">
        {/* Top Nav */}
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex h-14 items-center justify-between">
              <Link href="/" className="flex items-center gap-2 font-bold text-lg text-gray-900">
                <span className="text-brand-600">MS</span>
                <span className="hidden sm:inline">Mindstrate</span>
              </Link>
              <NavLinks items={NAV_ITEMS} />
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <LocaleProvider locale={locale}>
            {children}
          </LocaleProvider>
        </main>
      </body>
    </html>
  );
}
