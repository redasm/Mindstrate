import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE_NAME, issueAdminSession, verifyAdminKey } from '@/lib/admin-session';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const adminKey = typeof body.adminKey === 'string' ? body.adminKey : '';

  if (!verifyAdminKey(adminKey)) {
    return NextResponse.json({ error: 'Invalid admin key.' }, { status: 401 });
  }

  const token = issueAdminSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  return response;
}
