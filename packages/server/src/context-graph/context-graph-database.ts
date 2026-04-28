import type Database from 'better-sqlite3';
import { openSqliteDatabase } from '../storage/sqlite-database.js';

export type ContextGraphDbHandle = Database.Database | string;

export interface ContextGraphDatabaseConnection {
  db: Database.Database;
  ownsDb: boolean;
}

export function openContextGraphDatabase(dbOrPath: ContextGraphDbHandle): ContextGraphDatabaseConnection {
  if (typeof dbOrPath !== 'string') {
    return { db: dbOrPath, ownsDb: false };
  }

  return { db: openSqliteDatabase(dbOrPath), ownsDb: true };
}

export function initializeContextGraphSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS context_nodes (
      id TEXT PRIMARY KEY,
      substrate_type TEXT NOT NULL,
      domain_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      project TEXT,
      compression_level REAL NOT NULL DEFAULT 1.0,
      confidence REAL NOT NULL DEFAULT 0.5,
      quality_score REAL NOT NULL DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'candidate',
      source_ref TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      positive_feedback INTEGER NOT NULL DEFAULT 0,
      negative_feedback INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS context_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 1.0,
      evidence TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(source_id) REFERENCES context_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY(target_id) REFERENCES context_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS context_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      project TEXT,
      session_id TEXT,
      actor TEXT,
      content TEXT NOT NULL,
      metadata TEXT,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS node_embeddings (
      node_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      embedding TEXT NOT NULL,
      text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (node_id, model),
      FOREIGN KEY(node_id) REFERENCES context_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conflict_records (
      id TEXT PRIMARY KEY,
      project TEXT,
      node_ids TEXT NOT NULL,
      reason TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      resolved_at TEXT,
      resolution TEXT
    );

    CREATE TABLE IF NOT EXISTS projection_records (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      target TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      version INTEGER NOT NULL,
      projected_at TEXT NOT NULL,
      FOREIGN KEY(node_id) REFERENCES context_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS metabolism_runs (
      id TEXT PRIMARY KEY,
      project TEXT,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      stage_stats TEXT NOT NULL DEFAULT '{}',
      notes TEXT NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_context_nodes_project ON context_nodes(project);
    CREATE INDEX IF NOT EXISTS idx_context_nodes_substrate_type ON context_nodes(substrate_type);
    CREATE INDEX IF NOT EXISTS idx_context_nodes_domain_type ON context_nodes(domain_type);
    CREATE INDEX IF NOT EXISTS idx_context_nodes_status ON context_nodes(status);
    CREATE INDEX IF NOT EXISTS idx_context_edges_source ON context_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_context_edges_target ON context_edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_context_edges_relation_type ON context_edges(relation_type);
    CREATE INDEX IF NOT EXISTS idx_context_events_project ON context_events(project);
    CREATE INDEX IF NOT EXISTS idx_context_events_type ON context_events(type);
    CREATE INDEX IF NOT EXISTS idx_context_events_observed_at ON context_events(observed_at);
    CREATE INDEX IF NOT EXISTS idx_node_embeddings_model ON node_embeddings(model);
    CREATE INDEX IF NOT EXISTS idx_conflict_records_project ON conflict_records(project);
    CREATE INDEX IF NOT EXISTS idx_conflict_records_detected_at ON conflict_records(detected_at);
    CREATE INDEX IF NOT EXISTS idx_projection_records_node_id ON projection_records(node_id);
    CREATE INDEX IF NOT EXISTS idx_projection_records_target ON projection_records(target);
    CREATE INDEX IF NOT EXISTS idx_metabolism_runs_project ON metabolism_runs(project);
    CREATE INDEX IF NOT EXISTS idx_metabolism_runs_started_at ON metabolism_runs(started_at);
  `);
}
