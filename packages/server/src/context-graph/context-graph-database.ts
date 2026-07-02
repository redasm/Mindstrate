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

    -- Vector-search candidate ordering. The similarity scan pulls the top
    -- candidates ordered by quality_score/updated_at before scoring them
    -- (see NodeEmbeddingRepository.candidatesForSearch). Without this index a
    -- 100k+ node graph builds a TEMP B-TREE over the whole model set on every
    -- search — the first (cold-cache) memory_search/graph_knowledge_search then
    -- overran the MCP request timeout and surfaced as a transient error, while
    -- the retry hit warm pages and succeeded. The DESC column order matches the
    -- query so the planner can walk the index instead of sorting.
    CREATE INDEX IF NOT EXISTS idx_context_nodes_quality
      ON context_nodes(quality_score DESC, updated_at DESC);

    -- Lowercase indexes: the project filter on every list/query
    -- query uses LOWER(project) so callers can pass "Mindstrate" or
    -- "mindstrate" interchangeably. Without these expression indexes
    -- the fold would force a table scan on every read.
    CREATE INDEX IF NOT EXISTS idx_context_nodes_project_lower ON context_nodes(LOWER(project));
    CREATE INDEX IF NOT EXISTS idx_context_events_project_lower ON context_events(LOWER(project));
    CREATE INDEX IF NOT EXISTS idx_conflict_records_project_lower ON conflict_records(LOWER(project));
    CREATE INDEX IF NOT EXISTS idx_metabolism_runs_project_lower ON metabolism_runs(LOWER(project));
  `);

  // Lightweight additive migrations. SQLite raises an error if the column
  // already exists; swallowing keeps init idempotent.
  //
  // `embedding_vec` stores the L2-normalized embedding as a packed Float32
  // BLOB. It supersedes the legacy `embedding` TEXT column (a JSON array):
  // reading a BLOB is a zero-parse buffer view, and normalizing at write time
  // lets the similarity scan use a plain dot product. Old TEXT rows are
  // migrated lazily as they are read (see NodeEmbeddingRepository).
  for (const ddl of [
    `ALTER TABLE node_embeddings ADD COLUMN embedding_vec BLOB`,
  ]) {
    try { db.exec(ddl); } catch { /* column already exists */ }
  }

  ensureVectorSearchStatistics(db);
}

/**
 * Make the planner actually use `idx_context_nodes_quality`.
 *
 * Creating the index is not enough on a database that has never been analyzed
 * (no `sqlite_stat1`): with no statistics the planner keeps driving the
 * vector-candidate join from `node_embeddings(model)` and still builds a TEMP
 * B-TREE for the ORDER BY. Only after ANALYZE does it flip the join to walk the
 * quality index in order and stop the sort. Verified with EXPLAIN QUERY PLAN on
 * the production graph (108k nodes) and synthetic fixtures.
 *
 * Runs ANALYZE once, then no-ops: `initializeContextGraphSchema` runs in every
 * process that opens the store (team-server, web-ui, repo-scanner), so a blind
 * ANALYZE on each startup would be a needless full-table pass on a multi-GB DB.
 * The guard keys off whether the index already has a `sqlite_stat1` row. Scope
 * is limited to the two tables the candidate query touches — statistically
 * identical to a full ANALYZE for this query, without analyzing unrelated tables.
 */
function ensureVectorSearchStatistics(db: Database.Database): void {
  try {
    const analyzed = db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_stat1'`,
      )
      .get()
      && db
        .prepare(`SELECT 1 FROM sqlite_stat1 WHERE idx = 'idx_context_nodes_quality'`)
        .get();
    if (analyzed) return;
    db.exec('ANALYZE context_nodes;');
    db.exec('ANALYZE node_embeddings;');
  } catch {
    // ANALYZE is a pure optimization: a failure (e.g. a read-only handle or a
    // concurrent writer holding the lock) must never break store init. The
    // search still returns correct results, just with the cold-cache sort until
    // stats land on a later startup.
  }
}
