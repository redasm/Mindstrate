import { NextRequest, NextResponse } from 'next/server';
import { LOCALE_COOKIE } from '@/lib/i18n/index';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const locale = body?.locale;
  if (locale !== 'zh' && locale !== 'en') {
    return NextResponse.json({ error: 'unsupported locale' }, { status: 400 });
  }
  const resp = NextResponse.json({ ok: true, locale });
  resp.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false,
  });
  return resp;
}
