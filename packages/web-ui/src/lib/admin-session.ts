import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * In-process admin session store.
 *
 * Sessions are kept in memory only — the admin re-logs in after a Web UI
 * restart. There is exactly one admin role, so persisting sessions across
 * restart adds storage complexity without a real win.
 */

const sessions = new Map<string, { issuedAt: number }>();

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export const ADMIN_COOKIE_NAME = 'mindstrate_admin';

const safeCompare = (left: string, right: string): boolean => {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
};

export const verifyAdminKey = (candidate: string | undefined | null): boolean => {
  const expected = process.env['TEAM_API_KEY'] ?? '';
  if (!expected || !candidate) return false;
  return safeCompare(candidate, expected);
};

export const issueAdminSession = (): string => {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { issuedAt: Date.now() });
  return token;
};

export const isAdminSession = (token: string | undefined | null): boolean => {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.issuedAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
};

export const clearAdminSession = (token: string | undefined | null): void => {
  if (token) sessions.delete(token);
};
