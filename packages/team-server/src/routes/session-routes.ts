import type { Express } from 'express';
import {
  asyncRoute,
  authorizeProject,
  authorizeProjectForResource,
  readParam,
  requireScope,
  withInitializedMemory,
  type TeamRouteDeps,
} from '../http/route-support.js';

export const registerSessionRoutes = (app: Express, { memory }: TeamRouteDeps): void => {
  app.post('/api/session/start', withInitializedMemory(memory, async (req, res) => {
    const requestedProject = req.body.project || '';
    const authorized = authorizeProject(req, res, requestedProject || undefined, 'write');
    if (authorized === null) return;

    const project = authorized ?? requestedProject;
    const session = await memory.sessions.startSession({
      project,
      techContext: req.body.techContext,
    });

    const context = memory.sessions.formatSessionContext(project);
    res.json({ session, context: context || null });
  }));

  app.post('/api/session/save', withInitializedMemory(memory, async (req, res) => {
    const { sessionId, type, content, metadata } = req.body;
    if (!sessionId || !type || !content) {
      res.status(400).json({ error: 'sessionId, type, and content are required' });
      return;
    }

    const authorized = authorizeProjectForResource(
      req,
      res,
      () => memory.sessions.getSession(sessionId)?.project,
      'write',
    );
    if (authorized === null) return;

    memory.sessions.saveObservation({ sessionId, type, content, metadata });
    res.json({ success: true });
  }));

  app.post('/api/session/end', withInitializedMemory(memory, async (req, res) => {
    const { sessionId, summary, openTasks } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    const authorized = authorizeProjectForResource(
      req,
      res,
      () => memory.sessions.getSession(sessionId)?.project,
      'write',
    );
    if (authorized === null) return;

    if (summary) {
      memory.sessions.compressSession({ sessionId, summary, openTasks });
    }

    await memory.sessions.endSession(sessionId);
    res.json({ success: true, session: memory.sessions.getSession(sessionId) });
  }));

  app.get('/api/session/restore', asyncRoute((req, res) => {
    const requested = typeof req.query.project === 'string' ? req.query.project : undefined;
    const authorized = authorizeProject(req, res, requested, 'read');
    if (authorized === null) return;

    const project = authorized ?? requested ?? '';
    const context = memory.sessions.restoreSessionContext(project);
    const formatted = memory.sessions.formatSessionContext(project);
    res.json({ context, formatted: formatted || null });
  }));

  app.get('/api/session/active', asyncRoute((req, res) => {
    const requested = typeof req.query.project === 'string' ? req.query.project : undefined;
    const authorized = authorizeProject(req, res, requested, 'read');
    if (authorized === null) return;

    const project = authorized ?? requested ?? '';
    res.json({ session: memory.sessions.getActiveSession(project) });
  }));

  app.get('/api/session/:id', asyncRoute((req, res) => {
    const id = readParam(req.params.id);
    if (!id) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const authorized = authorizeProjectForResource(
      req,
      res,
      () => memory.sessions.getSession(id)?.project,
      'read',
    );
    if (authorized === null) return;

    const session = memory.sessions.getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json(session);
  }));

  app.post('/api/feedback', asyncRoute((req, res) => {
    if (!requireScope(req, res, 'write')) return;

    const { retrievalId, signal, context } = req.body;
    if (!retrievalId || !signal) {
      res.status(400).json({ error: 'retrievalId and signal are required' });
      return;
    }

    if (!['adopted', 'rejected', 'ignored', 'partial'].includes(signal)) {
      res.status(400).json({ error: 'signal must be adopted, rejected, ignored, or partial' });
      return;
    }

    const applied = memory.context.recordFeedback(retrievalId, signal, context);
    if (!applied) {
      res.status(404).json({ error: `Unknown retrievalId: ${retrievalId}` });
      return;
    }
    res.json({ success: true });
  }));

  app.get('/api/feedback/:nodeId', asyncRoute((req, res) => {
    const nodeId = readParam(req.params.nodeId);
    if (!nodeId) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (!requireScope(req, res, 'read')) return;

    res.json(memory.context.getFeedbackStats(nodeId));
  }));

  app.get('/api/stats', asyncRoute(async (_req, res) => {
    if (!requireScope(_req, res, 'read')) return;

    res.json(await memory.maintenance.getStats());
  }));
};
