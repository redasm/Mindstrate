import { NextResponse } from 'next/server';
import { ADMIN_COOKIE_NAME, clearAdminSession } from '@/lib/admin-session';

export async function POST(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`${ADMIN_COOKIE_NAME}=([^;]+)`));
  clearAdminSession(match?.[1]);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return response;
}
