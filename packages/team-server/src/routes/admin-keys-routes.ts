import type { Express } from 'express';
import type { ApiKeyScope } from '@mindstrate/protocol';
import { authorizeProject, readParam, withInitializedMemory, type TeamRouteDeps } from '../http/route-support.js';

const VALID_SCOPES: ApiKeyScope[] = ['read', 'write', 'admin'];

const parseScopes = (raw: unknown): ApiKeyScope[] | null => {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const scopes = new Set<ApiKeyScope>();
  for (const value of raw) {
    if (typeof value !== 'string' || !VALID_SCOPES.includes(value as ApiKeyScope)) return null;
    scopes.add(value as ApiKeyScope);
  }
  return [...scopes];
};

const parseProjects = (raw: unknown): string[] | null => {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const projects: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || value.trim() === '') return null;
    projects.push(value.trim());
  }
  return projects;
};

export const registerAdminKeysRoutes = (app: Express, { memory }: TeamRouteDeps): void => {
  app.get('/api/admin/keys', withInitializedMemory(memory, async (req, res) => {
    if (authorizeProject(req, res, undefined, 'admin') === null) return;
    res.json({ keys: memory.apiKeys.listActive() });
  }));

  app.post('/api/admin/keys', withInitializedMemory(memory, async (req, res) => {
    if (authorizeProject(req, res, undefined, 'admin') === null) return;

    const { name, scopes, projects } = req.body ?? {};
    if (typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const parsedScopes = parseScopes(scopes);
    if (!parsedScopes) {
      res.status(400).json({ error: 'scopes must be a non-empty array of read|write|admin' });
      return;
    }
    const parsedProjects = parseProjects(projects);
    if (!parsedProjects) {
      res.status(400).json({ error: 'projects must be a non-empty array of strings (use "*" for wildcard)' });
      return;
    }

    const principalName = req.teamPrincipal?.name;
    const created = memory.apiKeys.create({
      name: name.trim(),
      scopes: parsedScopes,
      projects: parsedProjects,
      createdBy: principalName,
    });
    res.status(201).json(created);
  }));

  app.delete('/api/admin/keys/:id', withInitializedMemory(memory, async (req, res) => {
    if (authorizeProject(req, res, undefined, 'admin') === null) return;

    const id = readParam(req.params.id);
    if (!id || !memory.apiKeys.getById(id)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const ok = memory.apiKeys.revoke(id);
    res.json({ revoked: ok });
  }));
};
