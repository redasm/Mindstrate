import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { isSessionSecretConfigured, SESSION_COOKIE, signSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  if (!isSessionSecretConfigured()) {
    return NextResponse.json(
      { error: 'TEAM_API_KEY is not configured on the server; sign-in is disabled.' },
      { status: 503 },
    );
  }
  let body: { name?: string; key?: string };
  try {
    body = (await req.json()) as { name?: string; key?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const name = (body.name ?? '').trim();
  const key = (body.key ?? '').trim();
  if (!name || !key) {
    return NextResponse.json({ error: 'Name and key are required' }, { status: 400 });
  }

  const memory = await getMemoryReady();
  const account = memory.apiKeys.findByNameAndKey(name, key);
  if (!account) {
    return NextResponse.json({ error: 'Invalid name or key' }, { status: 401 });
  }

  const cookie = signSession({
    id: account.id,
    name: account.name,
    role: account.role,
    projects: account.projects,
  });

  const res = NextResponse.json({
    ok: true,
    user: { name: account.name, role: account.role, projects: account.projects },
  });
  res.cookies.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
