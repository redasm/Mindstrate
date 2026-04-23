import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

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

export const createAuthMiddleware = (apiKey: string): RequestHandler => (req, res, next) => {
  if (!apiKey) {
    next();
    return;
  }

  const bearerToken = readBearerToken(req.headers.authorization);
  const headerToken = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined;
  const token = bearerToken ?? headerToken;

  if (!token || !safeCompare(token, apiKey)) {
    res.status(401).json({ error: 'Unauthorized. Provide valid API key via Authorization header or x-api-key.' });
    return;
  }

  next();
};
