import { NextRequest, NextResponse } from 'next/server';

// Middleware runs on the Edge runtime — Node `crypto` is unavailable, so we
// use Web Crypto for HMAC verification.
const SESSION_COOKIE = 'mindstrate_session';

const PUBLIC_PREFIXES = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/_next',
  '/favicon.ico',
  '/fonts',
];

const b64urlToBuf = (s: string): Uint8Array => {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const bufToB64url = (buf: ArrayBuffer): string => {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

interface SessionPayload {
  id: string;
  name: string;
  role: 'admin' | 'member';
  projects: string[];
  iat: number;
  exp: number;
}

async function verify(cookie: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!cookie || !secret) return null;
  const idx = cookie.indexOf('.');
  if (idx < 0) return null;
  const body = cookie.slice(0, idx);
  const mac = cookie.slice(idx + 1);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = bufToB64url(sig);
  if (mac.length !== expected.length) return null;
  // constant-time-ish compare
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;

  try {
    const json = new TextDecoder().decode(b64urlToBuf(body));
    const payload = JSON.parse(json) as SessionPayload;
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.TEAM_API_KEY ?? '';
  const session = await verify(cookie, secret);

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('return', pathname + search);
    return NextResponse.redirect(url);
  }

  // Member trying to access /settings: redirect to their first project
  if (session.role === 'member' && pathname.startsWith('/settings')) {
    const first = session.projects.find((p) => p !== '*');
    const url = req.nextUrl.clone();
    if (first) {
      url.pathname = `/p/${encodeURIComponent(first)}/knowledge`;
    } else {
      url.pathname = '/';
    }
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Member trying /p/<unauthorized>/...
  if (session.role === 'member' && pathname.startsWith('/p/')) {
    const slug = decodeURIComponent(pathname.split('/')[2] ?? '');
    const allowed = session.projects.includes('*') || session.projects.includes(slug);
    if (!allowed) {
      return new NextResponse('Not Found', { status: 404 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/).*)'],
};
