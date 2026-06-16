import type { Express, Request, Response } from 'express';
import {
  type ContextDomainType,
  type ContextEventType,
  type ContextNodeStatus,
  type InstallBundleResult,
  type PortableContextBundle,
  type PublishBundleOptions,
  type SubstrateType,
} from '@mindstrate/server';
import {
  authorizeProject,
  authorizeProjectForResource,
  parseLimit,
  requireScope,
  withInitializedMemory,
  type TeamRouteDeps,
} from '../http/route-support.js';

const authorizeAllBundleProjects = (
  req: Request,
  res: Response,
  bundle: PortableContextBundle,
  scope: 'read' | 'write' | 'admin',
): boolean => {
  const projects = new Set<string>();
  for (const node of bundle.nodes ?? []) {
    if (node.project) projects.add(node.project);
  }
  if (projects.size === 0) {
    if (authorizeProject(req, res, undefined, scope) === null) return false;
    return true;
  }
  for (const project of projects) {
    if (authorizeProject(req, res, project, scope) === null) return false;
  }
  return true;
};

export const registerContextRoutes = (app: Express, { memory }: TeamRouteDeps): void => {
  app.get('/api/graph/knowledge', withInitializedMemory(memory, async (req, res) => {
    const requested = typeof req.query.project === 'string' ? req.query.project : undefined;
    const authorized = authorizeProject(req, res, requested, 'read');
    if (authorized === null) return;

    const entries = memory.context.readGraphKnowledge({
      project: authorized ?? requested,
      limit: parseLimit(req.query.limit, 20),
    });

    res.json({ entries, total: entries.length });
  }));

  app.post('/api/graph/search', withInitializedMemory(memory, async (req, res) => {
    const { query, project, topK, limit, sessionId } = req.body;
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const authorized = authorizeProject(req, res, project, 'read');
    if (authorized === null) return;

    res.json(memory.context.queryGraphKnowledge(query, {
      project: authorized ?? project,
      topK: topK || 10,
      limit: limit || 50,
      sessionId,
    }));
  }));

  app.post('/api/context/events', withInitializedMemory(memory, async (req, res) => {
    const { type, content, project, sessionId, actor, domainType, substrateType, title, tags, metadata } = req.body;
    if (!type || !content) {
      res.status(400).json({ error: 'type and content are required' });
      return;
    }

    const authorizedProject = authorizeProject(req, res, project, 'write');
    if (authorizedProject === null) return;

    const result = memory.events.ingestEvent({
      type: type as ContextEventType,
      content,
      project: authorizedProject,
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
    const requested = typeof req.query.project === 'string' ? req.query.project : undefined;
    const authorized = authorizeProject(req, res, requested, 'read');
    if (authorized === null) return;

    const nodes = memory.context.queryContextGraph({
      query: typeof req.query.query === 'string' ? req.query.query : undefined,
      project: authorized ?? requested,
      substrateType: req.query.substrateType as SubstrateType | undefined,
      domainType: req.query.domainType as ContextDomainType | undefined,
      status: req.query.status as ContextNodeStatus | undefined,
      limit: parseLimit(req.query.limit, 20),
    });

    res.json({ nodes, total: nodes.length });
  }));

  app.get('/api/context/conflicts', withInitializedMemory(memory, async (req, res) => {
    const requested = typeof req.query.project === 'string' ? req.query.project : undefined;
    const authorized = authorizeProject(req, res, requested, 'read');
    if (authorized === null) return;

    const conflicts = memory.context.listConflictRecords(
      authorized ?? requested,
      parseLimit(req.query.limit, 20),
    );

    res.json({ conflicts, total: conflicts.length });
  }));

  app.get('/api/context/projections', withInitializedMemory(memory, async (req, res) => {
    if (!requireScope(req, res, 'read')) return;

    const records = memory.projections.listProjectionRecords({
      nodeId: typeof req.query.nodeId === 'string' ? req.query.nodeId : undefined,
      target: typeof req.query.target === 'string' ? req.query.target : undefined,
      limit: parseLimit(req.query.limit, 50),
    });

    res.json({ records, total: records.length });
  }));

  app.post('/api/context/conflicts/accept', withInitializedMemory(memory, async (req, res) => {
    const { conflictId, candidateNodeId, resolution } = req.body;
    if (!conflictId || !candidateNodeId || !resolution) {
      res.status(400).json({ error: 'conflictId, candidateNodeId, and resolution are required' });
      return;
    }

    const authorized = authorizeProjectForResource(
      req,
      res,
      () => memory.context.getConflictRecord(conflictId)?.project,
      'write',
    );
    if (authorized === null) return;

    res.json(memory.metabolism.acceptConflictCandidate({ conflictId, candidateNodeId, resolution }));
  }));

  app.post('/api/context/conflicts/reject', withInitializedMemory(memory, async (req, res) => {
    const { conflictId, candidateNodeId, reason } = req.body;
    if (!conflictId || !candidateNodeId || !reason) {
      res.status(400).json({ error: 'conflictId, candidateNodeId, and reason are required' });
      return;
    }

    const authorized = authorizeProjectForResource(
      req,
      res,
      () => memory.context.getConflictRecord(conflictId)?.project,
      'write',
    );
    if (authorized === null) return;

    res.json(memory.metabolism.rejectConflictCandidate({ conflictId, candidateNodeId, reason }));
  }));

  app.get('/api/context/edges', withInitializedMemory(memory, async (req, res) => {
    if (!requireScope(req, res, 'read')) return;

    const edges = memory.context.listContextEdges({
      sourceId: typeof req.query.sourceId === 'string' ? req.query.sourceId : undefined,
      targetId: typeof req.query.targetId === 'string' ? req.query.targetId : undefined,
      relationType: req.query.relationType as never,
      limit: parseLimit(req.query.limit, 50),
    });

    res.json({ edges, total: edges.length });
  }));

  app.post('/api/curate', withInitializedMemory(memory, async (req, res) => {
    if (!requireScope(req, res, 'read')) return;

    const { task, language, framework } = req.body;
    if (!task) {
      res.status(400).json({ error: 'task is required' });
      return;
    }

    const curated = await memory.assembly.curateContext(task, {
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

    const authorized = authorizeProject(req, res, project, 'read');
    if (authorized === null) return;
    const scopedProject = authorized ?? project;

    const assembled = await memory.assembly.assembleContext(task, {
      project: scopedProject,
      sessionId,
      context: {
        project: scopedProject,
        currentLanguage: language,
        currentFramework: framework,
      },
    });

    res.json(assembled);
  }));

  app.post('/api/context/internalize', withInitializedMemory(memory, async (req, res) => {
    const { project, limit } = req.body;
    const authorized = authorizeProject(req, res, project, 'write');
    if (authorized === null) return;

    res.json(memory.projections.generateInternalizationSuggestions({
      project: authorized,
      limit,
    }));
  }));

  app.post('/api/context/internalize/accept', withInitializedMemory(memory, async (req, res) => {
    const { project, limit, targets } = req.body;
    const authorized = authorizeProject(req, res, project, 'write');
    if (authorized === null) return;

    res.json(memory.projections.acceptInternalizationSuggestions({
      project: authorized,
      limit,
      targets,
    }));
  }));

  app.post('/api/context/obsidian-projection/write', withInitializedMemory(memory, async (req, res) => {
    const { project, limit, rootDir } = req.body;
    if (!rootDir) {
      res.status(400).json({ error: 'rootDir is required' });
      return;
    }

    const authorized = authorizeProject(req, res, project, 'write');
    if (authorized === null) return;

    const files = memory.projections.writeObsidianProjectionFiles({
      project: authorized,
      limit,
      rootDir,
    });
    res.json({ files });
  }));

  app.post('/api/context/obsidian-projection/import', withInitializedMemory(memory, async (req, res) => {
    const { filePath } = req.body;
    if (!filePath) {
      res.status(400).json({ error: 'filePath is required' });
      return;
    }

    if (authorizeProject(req, res, undefined, 'admin') === null) return;

    res.json(memory.projections.importObsidianProjectionFile(filePath));
  }));

  app.post('/api/context/project-graph/publish', withInitializedMemory(memory, async (req, res) => {
    const bundle = req.body.bundle as PortableContextBundle | undefined;
    const repoId = typeof req.body.repoId === 'string' ? req.body.repoId : undefined;
    if (!bundle || !repoId) {
      res.status(400).json({ error: 'bundle and repoId are required' });
      return;
    }

    if (!authorizeAllBundleProjects(req, res, bundle, 'write')) return;

    const result = memory.bundles.installBundle(bundle) as InstallBundleResult;
    const nodeId = bundle.nodeIds[0] ?? bundle.nodes?.[0]?.id;
    if (nodeId) {
      memory.projections.recordProjectGraphTeamProjection({ nodeId, repoId });
    }
    res.json(result);
  }));

  app.post('/api/context/project-graph/overlays', withInitializedMemory(memory, async (req, res) => {
    const { project, target, targetNodeId, targetEdgeId, kind, content, author, source } = req.body;
    if (!project || !kind || !content || !source) {
      res.status(400).json({ error: 'project, kind, content, and source are required' });
      return;
    }

    const authorized = authorizeProject(req, res, project, 'write');
    if (authorized === null) return;

    res.status(201).json(memory.context.createProjectGraphOverlay({
      project,
      target,
      targetNodeId,
      targetEdgeId,
      kind,
      content,
      author,
      source,
    }));
  }));

  app.get('/api/context/project-graph/overlays', withInitializedMemory(memory, async (req, res) => {
    const requested = typeof req.query.project === 'string' ? req.query.project : undefined;
    const authorized = authorizeProject(req, res, requested, 'read');
    if (authorized === null) return;

    const overlays = memory.context.listProjectGraphOverlays({
      project: authorized ?? requested,
      target: typeof req.query.target === 'string' ? req.query.target : undefined,
      targetNodeId: typeof req.query.targetNodeId === 'string' ? req.query.targetNodeId : undefined,
      targetEdgeId: typeof req.query.targetEdgeId === 'string' ? req.query.targetEdgeId : undefined,
      limit: parseLimit(req.query.limit, 200),
    });

    res.json({ overlays, total: overlays.length });
  }));

  app.post('/api/evolve', withInitializedMemory(memory, async (req, res) => {
    if (authorizeProject(req, res, undefined, 'admin') === null) return;

    const { autoApply, maxItems, mode } = req.body;
    res.json(await memory.metabolism.runEvolution({ autoApply, maxItems, mode }));
  }));

  app.post('/api/metabolism/run', withInitializedMemory(memory, async (req, res) => {
    const { project, trigger } = req.body;
    const authorized = authorizeProject(req, res, project, 'write');
    if (authorized === null) return;

    res.json(await memory.metabolism.runMetabolism({ project: authorized, trigger }));
  }));

  app.post('/api/metabolism/stage', withInitializedMemory(memory, async (req, res) => {
    const { project, stage } = req.body;
    const authorized = authorizeProject(req, res, project, 'write');
    if (authorized === null) return;

    switch (stage) {
      case 'digest':
        res.json(memory.metabolism.runDigest({ project: authorized }));
        return;
      case 'assimilate':
        res.json(memory.metabolism.runAssimilation({ project: authorized }));
        return;
      case 'compress':
        res.json(await memory.metabolism.runCompression({ project: authorized }));
        return;
      case 'prune':
        res.json(memory.metabolism.runPruning({ project: authorized }));
        return;
      case 'reflect':
        res.json(memory.metabolism.runReflection({ project: authorized }));
        return;
      default:
        res.status(400).json({ error: 'stage must be digest, assimilate, compress, prune, or reflect' });
    }
  }));

  app.post('/api/bundles/create', withInitializedMemory(memory, async (req, res) => {
    const { name, version, description, project, nodeIds, includeRelatedEdges } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const authorized = authorizeProject(req, res, project, 'write');
    if (authorized === null) return;

    res.status(201).json(memory.bundles.createBundle({
      name,
      version,
      description,
      project: authorized,
      nodeIds,
      includeRelatedEdges,
    }));
  }));

  app.post('/api/bundles/validate', withInitializedMemory(memory, async (req, res) => {
    if (!requireScope(req, res, 'read')) return;

    const bundle = req.body.bundle as PortableContextBundle | undefined;
    if (!bundle) {
      res.status(400).json({ error: 'bundle is required' });
      return;
    }

    res.json(memory.bundles.validateBundle(bundle));
  }));

  app.post('/api/bundles/install', withInitializedMemory(memory, async (req, res) => {
    const bundle = req.body.bundle as PortableContextBundle | undefined;
    if (!bundle) {
      res.status(400).json({ error: 'bundle is required' });
      return;
    }

    if (!authorizeAllBundleProjects(req, res, bundle, 'write')) return;

    res.json(memory.bundles.installBundle(bundle));
  }));

  app.post('/api/bundles/install-ref', withInitializedMemory(memory, async (req, res) => {
    const { registry, reference } = req.body;
    if (!registry || !reference) {
      res.status(400).json({ error: 'registry and reference are required' });
      return;
    }

    if (authorizeProject(req, res, undefined, 'admin') === null) return;

    res.json(await memory.bundles.installBundleFromRegistry({ registry, reference }));
  }));

  app.post('/api/bundles/publish', withInitializedMemory(memory, async (req, res) => {
    const bundle = req.body.bundle as PortableContextBundle | undefined;
    if (!bundle) {
      res.status(400).json({ error: 'bundle is required' });
      return;
    }

    if (!authorizeAllBundleProjects(req, res, bundle, 'write')) return;

    res.json(memory.bundles.publishBundle(bundle, {
      registry: req.body.registry,
      visibility: req.body.visibility,
    } as PublishBundleOptions));
  }));
};
