import type { Express } from 'express';
import {
  CaptureSource,
  KnowledgeType,
  toGraphKnowledgeView,
  type CreateKnowledgeInput,
} from '@mindstrate/server';
import { asyncRoute, authorizeProject, parseLimit, readParam, readStringArray, withInitializedMemory, type TeamRouteDeps } from '../http/route-support.js';
import { filterGraphKnowledgeViews, includesAll } from './knowledge-filters.js';

const createKnowledgeInput = (body: any): CreateKnowledgeInput => ({
  type: body.type || KnowledgeType.HOW_TO,
  title: body.title,
  problem: body.problem,
  solution: body.solution,
  codeSnippets: body.codeSnippets,
  tags: body.tags || [],
  context: {
    language: body.language || body.context?.language,
    framework: body.framework || body.context?.framework,
    project: body.project || body.context?.project,
    filePaths: body.context?.filePaths,
    dependencies: body.context?.dependencies,
  },
  author: body.author || 'team-member',
  source: body.source || CaptureSource.CLI,
  commitHash: body.commitHash,
  confidence: body.confidence,
  actionable: body.actionable,
});

export const registerKnowledgeRoutes = (app: Express, { memory }: TeamRouteDeps): void => {
  app.post('/api/knowledge', withInitializedMemory(memory, async (req, res) => {
    const body = req.body;

    if (!body.title || !body.solution) {
      res.status(400).json({ error: 'title and solution are required' });
      return;
    }

    const project = authorizeProject(req, res, body.project || body.context?.project, 'write');
    if (project === null) return;

    const input = createKnowledgeInput(body);
    input.context = { ...input.context, project };

    const result = await memory.knowledge.add(input);
    if (!result.success) {
      res.json(result);
      return;
    }

    res.status(201).json(result);
  }));

  app.get('/api/knowledge', asyncRoute((req, res) => {
    const minScore = typeof req.query.minScore === 'string' ? Number(req.query.minScore) : undefined;
    const project = authorizeProject(
      req,
      res,
      typeof req.query.project === 'string' ? req.query.project : undefined,
      'read',
    );
    if (project === null) return;
    const entries = filterGraphKnowledgeViews(memory.context.readGraphKnowledge({
      project,
      limit: parseLimit(req.query.limit, 50),
    }), {
      types: readStringArray(req.query.type) ?? [],
      tags: readStringArray(req.query.tag) ?? [],
      status: readStringArray(req.query.status) ?? [],
      minScore: Number.isFinite(minScore) ? minScore : undefined,
    });
    res.json({ entries, total: entries.length });
  }));

  app.get('/api/knowledge/:id', asyncRoute((req, res) => {
    const id = readParam(req.params.id);
    const view = id
      ? memory.context.queryContextGraph({ query: id, limit: 50 }).find((node) => node.id === id)
      : null;
    if (!view) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json(toGraphKnowledgeView(view));
  }));

  app.delete('/api/knowledge/:id', withInitializedMemory(memory, async (req, res) => {
    const id = readParam(req.params.id);
    if (!id) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const deleted = memory.context.deleteContextNode(id);
    if (!deleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json({ success: true });
  }));

  app.post('/api/search', withInitializedMemory(memory, async (req, res) => {
    const { query, topK, language, framework, minScore, sessionId } = req.body;
    const project = authorizeProject(req, res, req.body.project, 'read');
    if (project === null) return;
    const types = readStringArray(req.body.types ?? req.body.type);
    const tags = readStringArray(req.body.tags);
    const status = readStringArray(req.body.status);
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const results = memory.context.queryGraphKnowledge(query, {
      topK: topK || 10,
      project,
      limit: 100,
      sessionId,
    }).filter((result) => !types || types.includes(result.view.domainType))
      .filter((result) => !tags || includesAll(result.view.tags ?? [], tags))
      .filter((result) => !status || status.includes(result.view.status))
      .filter((result) => !language || result.view.tags.includes(language))
      .filter((result) => !framework || result.view.tags.includes(framework))
      .filter((result) => minScore === undefined || result.view.priorityScore >= minScore);

    res.json({ results, total: results.length });
  }));

  app.post('/api/sync', withInitializedMemory(memory, async (req, res) => {
    const { entries } = req.body;
    if (!Array.isArray(entries)) {
      res.status(400).json({ error: 'entries array is required' });
      return;
    }

    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        const result = await memory.knowledge.add({
          type: entry.type,
          title: entry.title,
          problem: entry.problem,
          solution: entry.solution,
          codeSnippets: entry.codeSnippets,
          tags: entry.tags,
          context: entry.context,
          author: entry.metadata?.author ?? entry.author,
          source: entry.metadata?.source ?? entry.source,
          commitHash: entry.metadata?.commitHash ?? entry.commitHash,
          confidence: entry.metadata?.confidence ?? entry.confidence,
          actionable: entry.actionable,
        });

        if (result.success) imported++;
        else if (result.duplicateOf) skipped++;
        else failed++;
      } catch {
        failed++;
      }
    }

    res.json({ imported, skipped, failed, total: entries.length });
  }));
};
