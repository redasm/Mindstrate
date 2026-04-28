import type Database from 'better-sqlite3';

export const initializeFeedbackSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback_events (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      query TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      signal TEXT NOT NULL DEFAULT 'pending',
      responded_at TEXT,
      context TEXT,
      session_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_knowledge
      ON feedback_events(node_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_signal
      ON feedback_events(signal);
    CREATE INDEX IF NOT EXISTS idx_feedback_session
      ON feedback_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_retrieved
      ON feedback_events(retrieved_at);
  `);
};
