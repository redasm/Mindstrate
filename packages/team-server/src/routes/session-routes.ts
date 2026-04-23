import type { Express } from 'express';
import { asyncRoute, readParam, type TeamRouteDeps } from '../http/route-support.js';

export const registerSessionRoutes = (app: Express, { memory }: TeamRouteDeps): void => {
  app.post('/api/session/start', asyncRoute(async (req, res) => {
    const project = req.body.project || '';
    const session = await memory.startSession({
      project,
      techContext: req.body.techContext,
    });

    const context = memory.formatSessionContext(project);
    res.json({ session, context: context || null });
  }));

  app.post('/api/session/save', asyncRoute((req, res) => {
    const { sessionId, type, content, metadata } = req.body;
    if (!sessionId || !type || !content) {
      res.status(400).json({ error: 'sessionId, type, and content are required' });
      return;
    }

    memory.saveObservation({ sessionId, type, content, metadata });
    res.json({ success: true });
  }));

  app.post('/api/session/end', asyncRoute(async (req, res) => {
    const { sessionId, summary, openTasks } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    if (summary) {
      memory.compressSession({ sessionId, summary, openTasks });
    }

    await memory.endSession(sessionId);
    res.json({ success: true, session: memory.getSession(sessionId) });
  }));

  app.get('/api/session/restore', asyncRoute((req, res) => {
    const project = typeof req.query.project === 'string' ? req.query.project : '';
    const context = memory.restoreSessionContext(project);
    const formatted = memory.formatSessionContext(project);
    res.json({ context, formatted: formatted || null });
  }));

  app.get('/api/session/active', asyncRoute((req, res) => {
    const project = typeof req.query.project === 'string' ? req.query.project : '';
    res.json({ session: memory.getActiveSession(project) });
  }));

  app.get('/api/session/:id', asyncRoute((req, res) => {
    const id = readParam(req.params.id);
    if (!id) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const session = memory.getSession(id);
    if (!session) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json(session);
  }));

  app.post('/api/feedback', asyncRoute((req, res) => {
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
  }));

  app.get('/api/feedback/:knowledgeId', asyncRoute((req, res) => {
    const knowledgeId = readParam(req.params.knowledgeId);
    if (!knowledgeId) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json(memory.getFeedbackStats(knowledgeId));
  }));

  app.get('/api/stats', asyncRoute(async (_req, res) => {
    res.json(await memory.getStats());
  }));
};
