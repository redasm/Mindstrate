import type { Express } from 'express';
import {
  type ContextDomainType,
  type ContextEventType,
  type ContextNodeStatus,
  type PortableContextBundle,
  type PublishBundleOptions,
  type SubstrateType,
} from '@mindstrate/server';
import { parseLimit, withInitializedMemory, type TeamRouteDeps } from '../http/route-support.js';

export const registerContextRoutes = (app: Express, { memory }: TeamRouteDeps): void => {
  app.get('/api/graph/knowledge', withInitializedMemory(memory, async (req, res) => {
    const project = typeof req.query.project === 'string' ? req.query.project : undefined;
    const entries = memory.readGraphKnowledge({
      project,
      limit: parseLimit(req.query.limit, 20),
    });

    res.json({ entries, total: entries.length });
  }));

  app.post('/api/graph/search', withInitializedMemory(memory, async (req, res) => {
    const { query, project, topK, limit } = req.body;
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    res.json(memory.queryGraphKnowledge(query, {
      project,
      topK: topK || 10,
      limit: limit || 50,
    }));
  }));

  app.post('/api/context/events', withInitializedMemory(memory, async (req, res) => {
    const { type, content, project, sessionId, actor, domainType, substrateType, title, tags, metadata } = req.body;
    if (!type || !content) {
      res.status(400).json({ error: 'type and content are required' });
      return;
    }

    const result = memory.ingestEvent({
      type: type as ContextEventType,
      content,
      project,
      sessionId,
      actor,
      domainType: domainType as ContextDomainType | undefined,
      substrateType: substrateType as SubstrateType | undefined,
      title,
      tags,
      metadata,
    });

    res.status(201).json({ eventId: result.event.id, nodeId: result.node.id });
  }));

  app.get('/api/context/graph', withInitializedMemory(memory, async (req, res) => {
    const nodes = memory.queryContextGraph({
      query: typeof req.query.query === 'string' ? req.query.query : undefined,
      project: typeof req.query.project === 'string' ? req.query.project : undefined,
      substrateType: req.query.substrateType as SubstrateType | undefined,
      domainType: req.query.domainType as ContextDomainType | undefined,
      status: req.query.status as ContextNodeStatus | undefined,
      limit: parseLimit(req.query.limit, 20),
    });

    res.json({ nodes, total: nodes.length });
  }));

  app.get('/api/context/conflicts', withInitializedMemory(memory, async (req, res) => {
    const conflicts = memory.listConflictRecords(
      typeof req.query.project === 'string' ? req.query.project : undefined,
      parseLimit(req.query.limit, 20),
    );

    res.json({ conflicts, total: conflicts.length });
  }));

  app.get('/api/context/edges', withInitializedMemory(memory, async (req, res) => {
    const edges = memory.listContextEdges({
      sourceId: typeof req.query.sourceId === 'string' ? req.query.sourceId : undefined,
      targetId: typeof req.query.targetId === 'string' ? req.query.targetId : undefined,
      relationType: req.query.relationType as never,
      limit: parseLimit(req.query.limit, 50),
    });

    res.json({ edges, total: edges.length });
  }));

  app.post('/api/curate', withInitializedMemory(memory, async (req, res) => {
    const { task, language, framework } = req.body;
    if (!task) {
      res.status(400).json({ error: 'task is required' });
      return;
    }

    const curated = await memory.curateContext(task, {
      currentLanguage: language,
      currentFramework: framework,
    });

    res.json(curated);
  }));

  app.post('/api/context/assemble', withInitializedMemory(memory, async (req, res) => {
    const { task, project, language, framework, sessionId } = req.body;
    if (!task) {
      res.status(400).json({ error: 'task is required' });
      return;
    }

    const assembled = await memory.assembleContext(task, {
      project,
      sessionId,
      context: {
        project,
        currentLanguage: language,
        currentFramework: framework,
      },
    });

    res.json(assembled);
  }));

  app.post('/api/context/internalize', withInitializedMemory(memory, async (req, res) => {
    const { project, limit } = req.body;
    res.json(memory.generateInternalizationSuggestions({
      project,
      limit,
    }));
  }));

  app.post('/api/evolve', withInitializedMemory(memory, async (req, res) => {
    const { autoApply, maxItems, mode } = req.body;
    res.json(await memory.runEvolution({ autoApply, maxItems, mode }));
  }));

  app.post('/api/metabolism/run', withInitializedMemory(memory, async (req, res) => {
    const { project, trigger } = req.body;
    res.json(await memory.runMetabolism({ project, trigger }));
  }));

  app.post('/api/bundles/create', withInitializedMemory(memory, async (req, res) => {
    const { name, version, description, project, nodeIds, includeRelatedEdges } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    res.status(201).json(memory.createBundle({
      name,
      version,
      description,
      project,
      nodeIds,
      includeRelatedEdges,
    }));
  }));

  app.post('/api/bundles/validate', withInitializedMemory(memory, async (req, res) => {
    const bundle = req.body.bundle as PortableContextBundle | undefined;
    if (!bundle) {
      res.status(400).json({ error: 'bundle is required' });
      return;
    }

    res.json(memory.validateBundle(bundle));
  }));

  app.post('/api/bundles/install', withInitializedMemory(memory, async (req, res) => {
    const bundle = req.body.bundle as PortableContextBundle | undefined;
    if (!bundle) {
      res.status(400).json({ error: 'bundle is required' });
      return;
    }

    res.json(memory.installBundle(bundle));
  }));

  app.post('/api/bundles/publish', withInitializedMemory(memory, async (req, res) => {
    const bundle = req.body.bundle as PortableContextBundle | undefined;
    if (!bundle) {
      res.status(400).json({ error: 'bundle is required' });
      return;
    }

    res.json(memory.publishBundle(bundle, {
      registry: req.body.registry,
      visibility: req.body.visibility,
    } as PublishBundleOptions));
  }));
};
