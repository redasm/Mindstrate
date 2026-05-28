import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import type { ApiKeyRole } from '@mindstrate/protocol';
import { getMemoryReady } from './memory';

export const SESSION_COOKIE = 'mindstrate_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  id: string;
  name: string;
  role: ApiKeyRole;
  projects: string[];
  iat: number;
  exp: number;
}

const getSecret = (): string => process.env['TEAM_API_KEY'] ?? '';

const b64urlEncode = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4), 'base64');

const sign = (data: string): string => {
  const mac = createHmac('sha256', getSecret()).update(data).digest();
  return b64urlEncode(mac);
};

export const signSession = (payload: Omit<SessionPayload, 'iat' | 'exp'>, now = Date.now()): string => {
  const full: SessionPayload = { ...payload, iat: now, exp: now + TTL_MS };
  const body = b64urlEncode(Buffer.from(JSON.stringify(full)));
  return `${body}.${sign(body)}`;
};

export const verifySession = (cookie: string | undefined | null): SessionPayload | null => {
  if (!cookie) return null;
  const idx = cookie.indexOf('.');
  if (idx < 0) return null;
  const body = cookie.slice(0, idx);
  const mac = cookie.slice(idx + 1);
  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return null;
  }
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf8')) as SessionPayload;
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
};

/** Read session from cookies in a server component / route handler. */
export async function readSession(): Promise<SessionPayload | null> {
  const c = await cookies();
  return verifySession(c.get(SESSION_COOKIE)?.value ?? null);
}

/** Verify a request's session (for route handlers). */
export function readSessionFromRequest(req: NextRequest): SessionPayload | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value ?? null);
}

/** Throws an HTTP Response for missing/invalid session. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await readSession();
  if (!session) {
    throw new Response('Unauthorized', { status: 401 });
  }
  return session;
}

export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== 'admin') {
    throw new Response('Not Found', { status: 404 });
  }
  return session;
}

export function requireSessionFromRequest(req: NextRequest): SessionPayload {
  const s = readSessionFromRequest(req);
  if (!s) throw new Response('Unauthorized', { status: 401 });
  return s;
}

export function requireAdminFromRequest(req: NextRequest): SessionPayload {
  const s = requireSessionFromRequest(req);
  if (s.role !== 'admin') throw new Response('Not Found', { status: 404 });
  return s;
}

/** Effective project list for a session: admin → all known projects, member → their list. */
export async function resolveVisibleProjects(session: SessionPayload): Promise<string[]> {
  if (session.role === 'admin' || session.projects.includes('*')) {
    const memory = await getMemoryReady();
    return memory.context.listKnownProjects();
  }
  return session.projects;
}

export function canAccessProject(session: SessionPayload, project: string): boolean {
  if (session.role === 'admin') return true;
  if (session.projects.includes('*')) return true;
  return session.projects.includes(project);
}
