import type { Express } from 'express';
import type {
  SkillEvolutionEvaluator,
  SkillEvolutionMetric,
  SkillEvolutionPatchStatus,
} from '@mindstrate/server';
import {
  authorizeProject,
  authorizeProjectForResource,
  parseLimit,
  readParam,
  withInitializedMemory,
  type TeamRouteDeps,
} from '../http/route-support.js';

export const registerSkillEvolutionRoutes = (app: Express, { memory }: TeamRouteDeps): void => {
  app.get('/api/skill-evolution/best-skill', withInitializedMemory(memory, async (req, res) => {
    const project = readParam(req.query.project);
    const authorized = authorizeProject(req, res, project, 'read');
    if (authorized === null) return;

    const artifact = memory.projections.renderBestSkillArtifact({
      project: authorized,
      limit: parseLimit(req.query.limit, 20),
    });
    res.json(artifact);
  }));

  app.get('/api/skill-evolution/patches', withInitializedMemory(memory, async (req, res) => {
    const project = readParam(req.query.project);
    const authorized = authorizeProject(req, res, project, 'read');
    if (authorized === null) return;

    const patches = memory.metabolism.listSkillPatches({
      project: authorized,
      sourceNodeId: readParam(req.query.sourceNodeId),
      status: readParam(req.query.status) as SkillEvolutionPatchStatus | undefined,
      limit: parseLimit(req.query.limit, 50),
    });

    res.json({ patches, total: patches.length });
  }));

  app.get('/api/skill-evolution/patches/:id', withInitializedMemory(memory, async (req, res) => {
    const id = readParam(req.params.id);
    const patch = id ? memory.metabolism.getSkillPatch(id) : null;
    if (!patch) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const authorized = authorizeProjectForResource(req, res, () => patch.project, 'read');
    if (authorized === null) return;

    res.json(patch);
  }));

  app.post('/api/skill-evolution/patches/:id/evaluate', withInitializedMemory(memory, async (req, res) => {
    const id = readParam(req.params.id);
    const patch = id ? memory.metabolism.getSkillPatch(id) : null;
    if (!patch) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const authorized = authorizeProjectForResource(req, res, () => patch.project, 'write');
    if (authorized === null) return;

    const { evaluator, metric, baselineScore, candidateScore, details } = req.body;
    if (typeof baselineScore !== 'number' || typeof candidateScore !== 'number') {
      res.status(400).json({ error: 'baselineScore and candidateScore are required numbers' });
      return;
    }

    res.json(memory.evaluation.evaluateSkillPatchScoreGate({
      patchId: patch.id,
      evaluator: (evaluator ?? 'retrieval') as SkillEvolutionEvaluator,
      metric: (metric ?? 'f1') as SkillEvolutionMetric,
      baselineScore,
      candidateScore,
      details,
    }));
  }));

  app.post('/api/skill-evolution/patches/:id/reject', withInitializedMemory(memory, async (req, res) => {
    const id = readParam(req.params.id);
    const patch = id ? memory.metabolism.getSkillPatch(id) : null;
    if (!patch) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const authorized = authorizeProjectForResource(req, res, () => patch.project, 'write');
    if (authorized === null) return;

    const reason = typeof req.body.reason === 'string' ? req.body.reason : undefined;
    if (!reason) {
      res.status(400).json({ error: 'reason is required' });
      return;
    }

    res.json(memory.metabolism.rejectSkillPatch({ patchId: patch.id, reason, metadata: req.body.metadata }));
  }));
};
