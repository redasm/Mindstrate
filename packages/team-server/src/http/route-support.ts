import type { Request, RequestHandler, Response } from 'express';
import type { Mindstrate } from '@mindstrate/server';

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

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';
