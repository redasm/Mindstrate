import type { Express } from 'express';
import type { ListProjectsResponse } from '@mindstrate/protocol';
import { withInitializedMemory, type TeamRouteDeps } from '../http/route-support.js';

export const registerProjectsRoutes = (app: Express, { memory }: TeamRouteDeps): void => {
  app.get('/api/projects', withInitializedMemory(memory, async (req, res) => {
    const principal = req.teamPrincipal;
    if (!principal) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (principal.projects.includes('*')) {
      const projects = memory.context.listKnownProjects();
      const response: ListProjectsResponse = { projects, wildcard: true };
      res.json(response);
      return;
    }

    const response: ListProjectsResponse = {
      projects: [...principal.projects],
      wildcard: false,
    };
    res.json(response);
  }));
};
