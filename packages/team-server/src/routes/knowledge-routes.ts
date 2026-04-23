import type { Express } from 'express';
import {
  CaptureSource,
  isValidKnowledgeType,
  KnowledgeType,
  type KnowledgeStatus,
  type CreateKnowledgeInput,
  type RetrievalFilter,
} from '@mindstrate/server';
import { asyncRoute, parseLimit, readParam, readStringArray, withInitializedMemory, type TeamRouteDeps } from '../http/route-support.js';

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

const createListFilter = (query: Record<string, unknown>): RetrievalFilter => {
  const filter: RetrievalFilter = {};
  const types = readStringArray(query.type);
  const tags = readStringArray(query.tag ?? query.tags);
  const status = readStringArray(query.status);

  if (types) filter.types = types as KnowledgeType[];
  if (typeof query.language === 'string') filter.language = query.language;
  if (typeof query.framework === 'string') filter.framework = query.framework;
  if (typeof query.project === 'string') filter.project = query.project;
  if (tags) filter.tags = tags;
  if (status) filter.status = status as KnowledgeStatus[];
  if (typeof query.minScore === 'string') filter.minScore = Number(query.minScore);

  return filter;
};

export const registerKnowledgeRoutes = (app: Express, { memory }: TeamRouteDeps): void => {
  app.post('/api/knowledge', withInitializedMemory(memory, async (req, res) => {
    const body = req.body;

    if (!body.title || !body.solution) {
      res.status(400).json({ error: 'title and solution are required' });
      return;
    }

    if (body.type && !isValidKnowledgeType(body.type)) {
      res.status(400).json({ error: `Invalid type: ${body.type}` });
      return;
    }

    const result = await memory.add(createKnowledgeInput(body));
    if (!result.success) {
      res.json({ success: false, message: result.message, duplicateOf: result.duplicateOf });
      return;
    }

    res.status(201).json({ success: true, knowledge: result.knowledge });
  }));

  app.get('/api/knowledge', asyncRoute((req, res) => {
    const entries = memory.list(createListFilter(req.query), parseLimit(req.query.limit, 50));
    res.json({ entries, total: entries.length });
  }));

  app.get('/api/knowledge/:id', asyncRoute((req, res) => {
    const id = readParam(req.params.id);
    const knowledge = id ? memory.get(id) : null;
    if (!knowledge) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json(knowledge);
  }));

  app.delete('/api/knowledge/:id', withInitializedMemory(memory, async (req, res) => {
    const id = readParam(req.params.id);
    if (!id) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const deleted = await memory.delete(id);
    if (!deleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json({ success: true });
  }));

  app.patch('/api/knowledge/:id/vote', asyncRoute((req, res) => {
    const { direction } = req.body;
    const id = readParam(req.params.id);
    if (direction !== 'up' && direction !== 'down') {
      res.status(400).json({ error: 'direction must be "up" or "down"' });
      return;
    }

    if (!id) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const knowledge = memory.get(id);
    if (!knowledge) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (direction === 'up') memory.upvote(id);
    else memory.downvote(id);

    res.json(memory.get(id));
  }));

  app.post('/api/search', withInitializedMemory(memory, async (req, res) => {
    const { query, topK, language, framework, project, minScore } = req.body;
    const types = readStringArray(req.body.types ?? req.body.type);
    const tags = readStringArray(req.body.tags);
    const status = readStringArray(req.body.status);
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const results = await memory.search(query, {
      topK: topK || 10,
      filter: {
        language,
        framework,
        project,
        types: types as KnowledgeType[] | undefined,
        tags,
        status: status as KnowledgeStatus[] | undefined,
        minScore,
      },
    });

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
        const result = await memory.add({
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
