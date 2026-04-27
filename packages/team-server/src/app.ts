import cors from 'cors';
import express, { type Express } from 'express';
import type { Mindstrate } from '@mindstrate/server';
import { createAuthMiddleware, type TeamApiKey } from './http/auth-middleware.js';
import { registerContextRoutes } from './routes/context-routes.js';
import { registerKnowledgeRoutes } from './routes/knowledge-routes.js';
import { registerSessionRoutes } from './routes/session-routes.js';

interface CreateAppOptions {
  apiKey: string;
  authKeys?: TeamApiKey[];
  memory: Mindstrate;
}

export const createApp = ({ apiKey, authKeys, memory }: CreateAppOptions): Express => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', createAuthMiddleware(authKeys ?? [{
    key: apiKey,
    scopes: ['read', 'write', 'admin'],
    projects: ['*'],
  }]));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  registerKnowledgeRoutes(app, { memory });
  registerContextRoutes(app, { memory });
  registerSessionRoutes(app, { memory });

  return app;
};
