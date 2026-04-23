/**
 * Mindstrate Team Server
 *
 * 中心化的团队知识服务器。
 * 所有团队成员的 MCP Server 连接到这个服务，
 * 知识自动汇聚、实时共享。
 *
 * 启动：
 *   TEAM_API_KEY=your-secret node dist/server.js
 *
 * 环境变量：
 *   TEAM_PORT            - 监听端口（默认 3388）
 *   TEAM_API_KEY         - API Key（客户端需携带此 key 认证）
 *   MINDSTRATE_DATA_DIR - 数据目录
 */

import express from 'express';
import cors from 'cors';
import pino from 'pino';
import { timingSafeEqual } from 'node:crypto';
import {
  Mindstrate,
  KnowledgeType,
  CaptureSource,
  isValidKnowledgeType,
} from '@mindstrate/server';
import type {
  CreateKnowledgeInput,
  RetrievalFilter,
} from '@mindstrate/server';

// ============================================================
// Logger
// ============================================================

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
});

// ============================================================
// Init
// ============================================================

const PORT = parseInt(process.env['TEAM_PORT'] ?? '3388', 10);
const API_KEY = process.env['TEAM_API_KEY'] ?? '';

/** Timing-safe string comparison to prevent timing attacks on API key */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid leaking length via timing
    timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Extract error message from unknown error */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

const memory = new Mindstrate();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================================
// Auth middleware
// ============================================================

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!API_KEY) {
    // 未配置 API Key，跳过认证（开发/内网环境）
    next();
    return;
  }

  const authHeader = req.headers['authorization'];
  const token = (authHeader && /^Bearer\s+/i.test(authHeader)
    ? authHeader.replace(/^Bearer\s+/i, '')
    : undefined)
    ?? req.headers['x-api-key'] as string;

  if (!token || !safeCompare(token, API_KEY)) {
    res.status(401).json({ error: 'Unauthorized. Provide valid API key via Authorization header or x-api-key.' });
    return;
  }

  next();
}

app.use('/api', authMiddleware);

// ============================================================
// Health
// ============================================================

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// ============================================================
// Knowledge CRUD
// ============================================================

/** POST /api/knowledge - 添加知识 */
app.post('/api/knowledge', async (req, res) => {
  try {
    await memory.init();
    const body = req.body;

    if (!body.title || !body.solution) {
      res.status(400).json({ error: 'title and solution are required' });
      return;
    }
    if (body.type && !isValidKnowledgeType(body.type)) {
      res.status(400).json({ error: `Invalid type: ${body.type}` });
      return;
    }

    const input: CreateKnowledgeInput = {
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
    };

    const result = await memory.add(input);
    if (result.success) {
      res.status(201).json({ success: true, knowledge: result.knowledge });
    } else {
      res.json({ success: false, message: result.message, duplicateOf: result.duplicateOf });
    }
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/** GET /api/knowledge - 列出知识 */
app.get('/api/knowledge', (req, res) => {
  try {
    const filter: RetrievalFilter = {};
    if (req.query.type) filter.types = [req.query.type as KnowledgeType];
    if (req.query.language) filter.language = req.query.language as string;
    if (req.query.framework) filter.framework = req.query.framework as string;
    if (req.query.project) filter.project = req.query.project as string;

    const limit = parseInt(req.query.limit as string || '50', 10);
    const entries = memory.list(filter, limit);
    res.json({ entries, total: entries.length });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/** GET /api/knowledge/:id */
app.get('/api/knowledge/:id', (req, res) => {
  const knowledge = memory.get(req.params.id);
  if (!knowledge) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(knowledge);
});

/** DELETE /api/knowledge/:id */
app.delete('/api/knowledge/:id', async (req, res) => {
  try {
    await memory.init();
    const deleted = await memory.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/** PATCH /api/knowledge/:id/vote */
app.patch('/api/knowledge/:id/vote', (req, res) => {
  const { direction } = req.body;
  if (direction !== 'up' && direction !== 'down') {
    res.status(400).json({ error: 'direction must be "up" or "down"' });
    return;
  }

  const knowledge = memory.get(req.params.id);
  if (!knowledge) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  if (direction === 'up') memory.upvote(req.params.id);
  else memory.downvote(req.params.id);

  res.json(memory.get(req.params.id));
});

// ============================================================
// Search
// ============================================================

/** POST /api/search */
app.post('/api/search', async (req, res) => {
  try {
    await memory.init();
    const { query, topK, language, framework, project, type, minScore } = req.body;

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
        types: type ? [type] : undefined,
        minScore,
      },
    });

    res.json({ results, total: results.length });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// ============================================================
// Session Memory
// ============================================================

/** POST /api/session/start */
app.post('/api/session/start', async (req, res) => {
  try {
    const session = await memory.startSession({
      project: req.body.project || '',
      techContext: req.body.techContext,
    });

    const context = memory.formatSessionContext(req.body.project || '');
    res.json({ session, context: context || null });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/** POST /api/session/save */
app.post('/api/session/save', (req, res) => {
  const { sessionId, type, content, metadata } = req.body;
  if (!sessionId || !type || !content) {
    res.status(400).json({ error: 'sessionId, type, and content are required' });
    return;
  }

  memory.saveObservation({ sessionId, type, content, metadata });
  res.json({ success: true });
});

/** POST /api/session/end */
app.post('/api/session/end', async (req, res) => {
  try {
    const { sessionId, summary, openTasks } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    if (summary) {
      memory.compressSession({ sessionId, summary, openTasks });
    }

    await memory.endSession(sessionId);
    const session = memory.getSession(sessionId);
    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/** GET /api/session/restore?project=xxx */
app.get('/api/session/restore', (req, res) => {
  const project = (req.query.project as string) || '';
  const context = memory.restoreSessionContext(project);
  const formatted = memory.formatSessionContext(project);
  res.json({ context, formatted: formatted || null });
});

// ============================================================
// Stats
// ============================================================

app.get('/api/stats', async (_req, res) => {
  try {
    const stats = await memory.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// ============================================================
// Batch sync (for bulk import from clients)
// ============================================================

/** POST /api/sync - 批量同步知识（客户端本地知识上传到服务器） */
app.post('/api/sync', async (req, res) => {
  try {
    await memory.init();
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
        });

        if (result.success) imported++;
        else if (result.duplicateOf) skipped++;
        else failed++;
      } catch {
        failed++;
      }
    }

    res.json({ imported, skipped, failed, total: entries.length });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// ============================================================
// Feedback Loop (自动反馈闭环)
// ============================================================

/** POST /api/feedback - 记录自动反馈 */
app.post('/api/feedback', (req, res) => {
  const { retrievalId, signal, context } = req.body;
  if (!retrievalId || !signal) {
    res.status(400).json({ error: 'retrievalId and signal are required' });
    return;
  }
  if (!['adopted', 'rejected', 'ignored', 'partial'].includes(signal)) {
    res.status(400).json({ error: 'signal must be adopted, rejected, ignored, or partial' });
    return;
  }

  memory.recordFeedback(retrievalId, signal, context);
  res.json({ success: true });
});

/** GET /api/feedback/:knowledgeId - 获取知识反馈统计 */
app.get('/api/feedback/:knowledgeId', (req, res) => {
  const stats = memory.getFeedbackStats(req.params.knowledgeId);
  res.json(stats);
});

// ============================================================
// Context Curation (上下文策划)
// ============================================================

/** POST /api/curate - 上下文策划 */
app.post('/api/curate', async (req, res) => {
  try {
    await memory.init();
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
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/** POST /api/context/assemble - 组装工作上下文 */
app.post('/api/context/assemble', async (req, res) => {
  try {
    await memory.init();
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
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// ============================================================
// Knowledge Evolution (知识进化)
// ============================================================

/** POST /api/evolve - 运行知识进化 */
app.post('/api/evolve', async (req, res) => {
  try {
    await memory.init();
    const { autoApply, maxItems, mode } = req.body;
    const result = await memory.runEvolution({ autoApply, maxItems, mode });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

// ============================================================
// Start
// ============================================================

async function main() {
  await memory.init();

  app.listen(PORT, () => {
    logger.info({ port: PORT, dataDir: memory.getConfig().dataDir }, 'Mindstrate Team Server started');

    if (!API_KEY) {
      logger.warn(
        'SECURITY WARNING: No TEAM_API_KEY configured. Server is running WITHOUT authentication. ' +
        'Anyone with network access can read/write/delete knowledge. ' +
        'Set TEAM_API_KEY environment variable to enable API key authentication. ' +
        'This is acceptable only for local development or trusted private networks.'
      );
    } else {
      logger.info('Authentication: API Key required');
    }
  });
}

process.on('SIGINT', () => { logger.info('Shutting down (SIGINT)'); memory.close(); process.exit(0); });
process.on('SIGTERM', () => { logger.info('Shutting down (SIGTERM)'); memory.close(); process.exit(0); });

main().catch(err => {
  logger.fatal({ err }, 'Failed to start team server');
  process.exit(1);
});
