import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Mindstrate } from '@mindstrate/server';

export type TeamScope = 'read' | 'write' | 'admin';

export interface TeamPrincipal {
  name: string;
  scopes: TeamScope[];
  projects: string[];
}

declare global {
  namespace Express {
    interface Request {
      teamPrincipal?: TeamPrincipal;
    }
  }
}

/**
 * Constant-time string compare that does not leak the length of either side.
 *
 * Both inputs are first folded into a fixed-size SHA-256 digest so the
 * subsequent `timingSafeEqual` always operates on equal-length buffers and
 * its runtime is independent of attacker-controlled input length and of the
 * configured key length.
 */
export const safeCompare = (left: string, right: string): boolean => {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
};

const readBearerToken = (authorization: string | undefined): string | undefined => (
  authorization && /^Bearer\s+/i.test(authorization)
    ? authorization.replace(/^Bearer\s+/i, '')
    : undefined
);

export interface AuthMiddlewareOptions {
  adminKey: string;
  memory: Mindstrate;
}

export const createAuthMiddleware = ({ adminKey, memory }: AuthMiddlewareOptions): RequestHandler => (req, res, next) => {
  if (!adminKey) {
    res.status(500).json({ error: 'Team Server authentication is not configured.' });
    return;
  }

  const bearerToken = readBearerToken(req.headers.authorization);
  const headerToken = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined;
  const token = bearerToken ?? headerToken;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized. Provide valid API key via Authorization header or x-api-key.' });
    return;
  }

  if (safeCompare(token, adminKey)) {
    req.teamPrincipal = { name: 'admin', scopes: ['read', 'write', 'admin'], projects: ['*'] };
    next();
    return;
  }

  const memberKey = memory.apiKeys.findActiveByKey(token);
  if (!memberKey) {
    res.status(401).json({ error: 'Unauthorized. Provide valid API key via Authorization header or x-api-key.' });
    return;
  }

  req.teamPrincipal = {
    name: memberKey.name,
    scopes: memberKey.scopes.length > 0 ? memberKey.scopes : ['read', 'write', 'admin'],
    projects: memberKey.projects.length > 0 ? memberKey.projects : ['*'],
  };
  next();
};
