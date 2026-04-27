import type { Request, RequestHandler, Response } from 'express';
import type { Mindstrate } from '@mindstrate/server';
import type { TeamScope } from './auth-middleware.js';

export interface TeamRouteDeps {
  memory: Mindstrate;
}

type RouteHandler = (req: Request, res: Response) => void | Promise<void>;

export const asyncRoute = (handler: RouteHandler): RequestHandler => (req, res) => {
  void Promise.resolve(handler(req, res)).catch((error: unknown) => {
    res.status(500).json({ error: getErrorMessage(error) });
  });
};

export const withInitializedMemory = (
  memory: Mindstrate,
  handler: RouteHandler,
): RequestHandler => asyncRoute(async (req, res) => {
  await memory.init();
  await handler(req, res);
});

export const parseLimit = (value: unknown, fallback: number): number => {
  const parsed = parseInt(typeof value === 'string' ? value : '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const readParam = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
};

export const readStringArray = (value: unknown): string[] | undefined => {
  if (typeof value === 'string') {
    const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
    return entries.length > 0 ? entries : undefined;
  }

  if (Array.isArray(value)) {
    const entries = value.filter((entry): entry is string => typeof entry === 'string');
    return entries.length > 0 ? entries : undefined;
  }

  return undefined;
};

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

export const authorizeProject = (
  req: Request,
  res: Response,
  project: string | undefined,
  scope: TeamScope,
): string | undefined | null => {
  const principal = req.teamPrincipal;
  if (!principal) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  if (!principal.scopes.includes(scope) && !principal.scopes.includes('admin')) {
    res.status(403).json({ error: `Forbidden: ${scope} scope is required.` });
    return null;
  }

  if (principal.projects.includes('*')) return project;

  if (!project) {
    if (principal.projects.length === 1) return principal.projects[0];
    res.status(403).json({ error: 'Forbidden: project is required for scoped API keys.' });
    return null;
  }

  if (!principal.projects.includes(project)) {
    res.status(403).json({ error: `Forbidden: API key is not authorized for project "${project}".` });
    return null;
  }

  return project;
};
