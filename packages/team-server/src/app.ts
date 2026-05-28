import cors from 'cors';
import express, { type Express } from 'express';
import type { Mindstrate } from '@mindstrate/server';
import { createAuthMiddleware } from './http/auth-middleware.js';
import { registerAdminKeysRoutes } from './routes/admin-keys-routes.js';
import { registerContextRoutes } from './routes/context-routes.js';
import { registerKnowledgeRoutes } from './routes/knowledge-routes.js';
import { registerProjectsRoutes } from './routes/projects-routes.js';
import { registerSessionRoutes } from './routes/session-routes.js';

interface CreateAppOptions {
  adminKey: string;
  memory: Mindstrate;
}

export const createApp = ({ adminKey, memory }: CreateAppOptions): Express => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', createAuthMiddleware({ adminKey, memory }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  registerKnowledgeRoutes(app, { memory });
  registerContextRoutes(app, { memory });
  registerProjectsRoutes(app, { memory });
  registerSessionRoutes(app, { memory });
  registerAdminKeysRoutes(app, { memory });

  return app;
};
