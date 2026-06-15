/**
 * Native ↔ script binding inference, executed as set-based SQL against the
 * persisted graph instead of over in-memory node maps.
 *
 * Two passes, run after the raw graph is written to the store:
 *   - BINDS_TO: connect native CLASS/FUNCTION nodes to DEPENDENCY nodes that
 *     look like script-side calls of the same symbol (matched on a normalized
 *     symbol key).
 *   - GENERATED_FROM: connect generated FILE nodes back to the native symbol
 *     they were generated from (same base name), and stamp the generated file
 *     with `sourceGeneratedFrom`.
 *
 * Doing this in SQL is what keeps indexing memory bounded on large checkouts:
 * the old in-memory version had to `Array.from(nodes.values())` the whole graph
 * twice and accumulate every binding edge in a heap-resident map. Here the
 * normalized keys are computed by deterministic UDFs into indexed temp tables,
 * the join runs in the DB, and only the matching pairs (the edges we have to
 * write anyway) ever materialize in JS.
 */

import * as path from 'node:path';
import type Database from 'better-sqlite3';
import {
  ProjectGraphEdgeKind,
  type EvidenceRef,
  type ProjectGraphEdgeDto,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { makeEdge, normalizeSymbolName } from './project-graph-fact-builder.js';
import {
  applyEdgeWrites,
  emptyWriteResult,
  type ProjectGraphWriteResult,
} from './graph-writer.js';

/** normalize + drop a single leading `u` (Unreal `U`-prefix convention). */
const bindingKey = (value: string): string => normalizeSymbolName(value).replace(/^u/, '');

const generatedBindingKey = (filePath: string): string | null => {
  const base = path.basename(filePath).replace(/\.[^.]+$/, '');
  if (!base) return null;
  const key = bindingKey(base);
  return key || null;
};

// UDFs are per-connection; register once per db so re-indexing the same store
// doesn't throw "function already registered".
const registeredDbs = new WeakSet<Database.Database>();
const ensureFunctions = (db: Database.Database): void => {
  if (registeredDbs.has(db)) return;
  db.function('pg_bind_key', { deterministic: true }, (value: unknown) =>
    value == null ? null : bindingKey(String(value)));
  db.function('pg_gen_key', { deterministic: true }, (value: unknown) =>
    value == null ? null : generatedBindingKey(String(value)));
  registeredDbs.add(db);
};

/**
 * Infer and persist binding edges for a project's graph. Idempotent: edge ids
 * are deterministic, so a re-index upserts rather than duplicating.
 */
export const bindProjectGraph = (store: ContextGraphStore, project: string): ProjectGraphWriteResult => {
  const db = store.rawDatabase;
  ensureFunctions(db);

  const bindsToEdges = collectBindsToEdges(db, project);
  const generated = collectGeneratedBindings(db, project);

  const result = emptyWriteResult();
  if (bindsToEdges.length === 0 && generated.edges.length === 0) return result;

  const now = new Date().toISOString();
  const stampSource = db.prepare(
    "UPDATE context_nodes SET metadata = json_set(metadata, '$.sourceGeneratedFrom', ?), updated_at = ? WHERE id = ?",
  );

  store.transaction(() => {
    for (const update of generated.metadataUpdates) {
      stampSource.run(update.sourceId, now, update.nodeId);
    }
    applyEdgeWrites(store, [...bindsToEdges, ...generated.edges], result);
  });

  return result;
};

interface BindsToRow {
  sourceId: string;
  evidence: string | null;
  targetId: string;
}

const collectBindsToEdges = (db: Database.Database, project: string): ProjectGraphEdgeDto[] => {
  db.exec('DROP TABLE IF EXISTS _pg_native; DROP TABLE IF EXISTS _pg_dep;');
  db.prepare(
    `CREATE TEMP TABLE _pg_native AS
       SELECT id, json_extract(metadata, '$.evidence') AS evidence, pg_bind_key(title) AS k
       FROM context_nodes
       WHERE project = ?
         AND json_extract(metadata, '$.kind') IN ('class', 'function')
         AND pg_bind_key(title) <> ''`,
  ).run(project);
  db.exec('CREATE INDEX _pg_native_k ON _pg_native(k);');
  db.prepare(
    `CREATE TEMP TABLE _pg_dep AS
       SELECT id, pg_bind_key(title) AS k
       FROM context_nodes
       WHERE project = ?
         AND json_extract(metadata, '$.kind') = 'dependency'
         AND pg_bind_key(title) <> ''`,
  ).run(project);
  db.exec('CREATE INDEX _pg_dep_k ON _pg_dep(k);');

  const rows = db.prepare(
    `SELECT n.id AS sourceId, n.evidence AS evidence, d.id AS targetId
       FROM _pg_native n
       JOIN _pg_dep d ON n.k = d.k`,
  ).all() as BindsToRow[];
  db.exec('DROP TABLE IF EXISTS _pg_native; DROP TABLE IF EXISTS _pg_dep;');

  return rows.map((row) =>
    makeEdge(row.sourceId, row.targetId, ProjectGraphEdgeKind.BINDS_TO, parseEvidence(row.evidence)));
};

interface GeneratedRow {
  nodeId: string;
  evidence: string | null;
  sourceId: string | null;
}

interface GeneratedBindings {
  edges: ProjectGraphEdgeDto[];
  metadataUpdates: { nodeId: string; sourceId: string }[];
}

const collectGeneratedBindings = (db: Database.Database, project: string): GeneratedBindings => {
  db.exec('DROP TABLE IF EXISTS _pg_sym;');
  db.prepare(
    `CREATE TEMP TABLE _pg_sym AS
       SELECT id, pg_bind_key(title) AS k
       FROM context_nodes
       WHERE project = ?
         AND json_extract(metadata, '$.kind') IN ('class', 'function', 'type')
         AND pg_bind_key(title) <> ''`,
  ).run(project);
  db.exec('CREATE INDEX _pg_sym_k ON _pg_sym(k);');

  // One source per generated file; when several symbols share a name we pick
  // the lowest id so the choice is deterministic across runs.
  const rows = db.prepare(
    `SELECT g.id AS nodeId,
            json_extract(g.metadata, '$.evidence') AS evidence,
            (SELECT s.id FROM _pg_sym s WHERE s.k = pg_gen_key(g.title) ORDER BY s.id LIMIT 1) AS sourceId
       FROM context_nodes g
       WHERE g.project = ?
         AND json_extract(g.metadata, '$.kind') = 'file'
         AND json_extract(g.metadata, '$.generated') = 1`,
  ).all(project) as GeneratedRow[];
  db.exec('DROP TABLE IF EXISTS _pg_sym;');

  const edges: ProjectGraphEdgeDto[] = [];
  const metadataUpdates: { nodeId: string; sourceId: string }[] = [];
  for (const row of rows) {
    if (!row.sourceId) continue;
    edges.push(makeEdge(row.nodeId, row.sourceId, ProjectGraphEdgeKind.GENERATED_FROM, parseEvidence(row.evidence)));
    metadataUpdates.push({ nodeId: row.nodeId, sourceId: row.sourceId });
  }
  return { edges, metadataUpdates };
};

const parseEvidence = (raw: string | null): EvidenceRef[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EvidenceRef[]) : [];
  } catch {
    return [];
  }
};
