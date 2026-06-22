import type { Express } from 'express';
import type { EvalCaseKind } from '@mindstrate/server';
import {
  authorizeProject,
  parseLimit,
  readParam,
  withInitializedMemory,
  type TeamRouteDeps,
} from '../http/route-support.js';

export const registerEvalRoutes = (app: Express, { memory }: TeamRouteDeps): void => {
  app.get('/api/eval/cases', withInitializedMemory(memory, async (req, res) => {
    if (authorizeProject(req, res, undefined, 'read') === null) return;
    const kind = readParam(req.query.kind) as EvalCaseKind | undefined;
    const cases = memory.evaluation.listEvalCases(kind ? { kind } : undefined);
    res.json({ cases, total: cases.length });
  }));

  app.post('/api/eval/cases', withInitializedMemory(memory, async (req, res) => {
    if (authorizeProject(req, res, undefined, 'write') === null) return;
    const { query, expectedIds, language, framework, kind } = req.body;
    if (typeof query !== 'string' || !Array.isArray(expectedIds)) {
      res.status(400).json({ error: 'query (string) and expectedIds (array) are required' });
      return;
    }
    const created = memory.evaluation.addEvalCase(query, expectedIds, {
      language,
      framework,
      kind: kind as EvalCaseKind | undefined,
    });
    res.status(201).json(created);
  }));

  app.post('/api/eval/cases/generate', withInitializedMemory(memory, async (req, res) => {
    if (authorizeProject(req, res, undefined, 'write') === null) return;
    const project = typeof req.body.project === 'string' ? req.body.project : undefined;
    const limit = typeof req.body.limit === 'number' ? req.body.limit : undefined;
    const kind = typeof req.body.kind === 'string' ? (req.body.kind as EvalCaseKind) : undefined;
    const holdoutEveryNth = typeof req.body.holdoutEveryNth === 'number' ? req.body.holdoutEveryNth : undefined;
    const result = await memory.evaluation.generateEvalCases({ project, limit, kind, holdoutEveryNth });
    res.status(201).json(result);
  }));

  app.delete('/api/eval/cases/:id', withInitializedMemory(memory, async (req, res) => {
    if (authorizeProject(req, res, undefined, 'write') === null) return;
    const id = readParam(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }
    const deleted = memory.evaluation.deleteEvalCase(id);
    res.json({ deleted });
  }));

  app.post('/api/eval/run', withInitializedMemory(memory, async (req, res) => {
    if (authorizeProject(req, res, undefined, 'read') === null) return;
    const topK = typeof req.body.topK === 'number' ? req.body.topK : undefined;
    const kind = typeof req.body.kind === 'string' ? (req.body.kind as EvalCaseKind) : undefined;
    const result = await memory.evaluation.runEvaluation(topK, kind ? { kind } : undefined);
    res.json(result);
  }));
};
