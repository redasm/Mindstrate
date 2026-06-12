import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import type { ApiKeyRole } from '@mindstrate/protocol';
import { getMemoryReady } from './memory';
import { listWorkspaceProjects } from './workspace-projects';

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

/**
 * Sessions are HMAC-signed with TEAM_API_KEY. An empty secret would make
 * every cookie forgeable, so signing/verification refuse to operate
 * without it (the Edge middleware independently rejects all requests in
 * that state as well).
 */
const getSecret = (): string => {
  const secret = process.env['TEAM_API_KEY'] ?? '';
  if (!secret) throw new Error('TEAM_API_KEY is not configured; sessions are disabled.');
  return secret;
};

export const isSessionSecretConfigured = (): boolean => Boolean(process.env['TEAM_API_KEY']);

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

/**
 * The cookie bakes in role/projects for up to 30 days, so admin actions
 * (disable, demote, project reassignment, key deletion) must not have to
 * wait for expiry: every guarded request re-reads the account from the
 * store and uses the stored role/projects instead of the cookie's. A
 * revoked or deleted account invalidates the session immediately.
 */
async function resolveActiveSession(payload: SessionPayload | null): Promise<SessionPayload | null> {
  if (!payload) return null;
  const memory = await getMemoryReady();
  const account = memory.apiKeys.getById(payload.id);
  if (!account || account.revokedAt) return null;
  return {
    ...payload,
    name: account.name,
    role: account.role,
    projects: account.projects,
  };
}

/** Read and revalidate the session from cookies in a server component / route handler. */
export async function readSession(): Promise<SessionPayload | null> {
  const c = await cookies();
  return resolveActiveSession(verifySession(c.get(SESSION_COOKIE)?.value ?? null));
}

/** Verify and revalidate a request's session (for route handlers). */
export async function readSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  return resolveActiveSession(verifySession(req.cookies.get(SESSION_COOKIE)?.value ?? null));
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

export async function requireSessionFromRequest(req: NextRequest): Promise<SessionPayload> {
  const s = await readSessionFromRequest(req);
  if (!s) throw new Response('Unauthorized', { status: 401 });
  return s;
}

export async function requireAdminFromRequest(req: NextRequest): Promise<SessionPayload> {
  const s = await requireSessionFromRequest(req);
  if (s.role !== 'admin') throw new Response('Not Found', { status: 404 });
  return s;
}

/** Effective project list for a session: admin → all known projects, member → their list. */
export async function resolveVisibleProjects(session: SessionPayload): Promise<string[]> {
  if (session.role === 'admin' || session.projects.includes('*')) {
    const memory = await getMemoryReady();
    return listWorkspaceProjects(memory);
  }
  return session.projects;
}

export function canAccessProject(session: SessionPayload, project: string): boolean {
  if (session.role === 'admin') return true;
  if (session.projects.includes('*')) return true;
  return session.projects.includes(project);
}
