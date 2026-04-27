import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export type TeamScope = 'read' | 'write' | 'admin';

export interface TeamApiKey {
  key: string;
  name?: string;
  scopes?: TeamScope[];
  projects?: string[];
}

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

const safeCompare = (left: string, right: string): boolean => {
  if (left.length !== right.length) {
    timingSafeEqual(Buffer.from(left), Buffer.from(left));
    return false;
  }

  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
};

const readBearerToken = (authorization: string | undefined): string | undefined => (
  authorization && /^Bearer\s+/i.test(authorization)
    ? authorization.replace(/^Bearer\s+/i, '')
    : undefined
);

export const createAuthMiddleware = (apiKeys: TeamApiKey[]): RequestHandler => (req, res, next) => {
  const configuredKeys = apiKeys.filter((entry) => entry.key);
  if (configuredKeys.length === 0) {
    res.status(500).json({ error: 'Team Server authentication is not configured.' });
    return;
  }

  const bearerToken = readBearerToken(req.headers.authorization);
  const headerToken = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined;
  const token = bearerToken ?? headerToken;

  const match = token
    ? configuredKeys.find((entry) => safeCompare(token, entry.key))
    : undefined;

  if (!match) {
    res.status(401).json({ error: 'Unauthorized. Provide valid API key via Authorization header or x-api-key.' });
    return;
  }

  req.teamPrincipal = {
    name: match.name ?? 'api-key',
    scopes: match.scopes?.length ? match.scopes : ['read', 'write', 'admin'],
    projects: match.projects?.length ? match.projects : ['*'],
  };
  next();
};
