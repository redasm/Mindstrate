import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { detectLocale, getHtmlLang } from '@/lib/i18n/index';
import { LocaleProvider } from '@/lib/i18n/provider';

export const metadata: Metadata = {
  title: 'Mindstrate',
  description: 'AI memory and context substrate for agents and teams',
};

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await detectLocale();
  return (
    <html
      lang={getHtmlLang(locale)}
      className={jetbrains.variable}
      style={
        {
          // Cabinet Grotesk + Satoshi are loaded from Fontshare CDN below.
          // Aliasing the CSS variables to the family names lets Tailwind's
          // var(--font-cabinet) / var(--font-satoshi) resolve cleanly.
          ['--font-cabinet' as string]: "'Cabinet Grotesk'",
          ['--font-satoshi' as string]: "'Satoshi'",
        } as React.CSSProperties
      }
    >
      <head>
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,600,700,800&f[]=satoshi@400,500,600&display=swap"
        />
      </head>
      <body className="bg-white min-h-screen text-surface-900">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
