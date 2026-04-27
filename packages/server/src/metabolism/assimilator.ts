import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  MetabolismStage,
  SubstrateType,
  type ContextNode,
  type MetabolismStageStats,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { MetabolismStageOptions } from './metabolism-engine.js';

const groupEpisodesBySource = (episodes: ContextNode[]): Map<string, ContextNode[]> => {
  const groups = new Map<string, ContextNode[]>();
  for (const episode of episodes) {
    const sourceRef = episode.sourceRef ?? episode.metadata?.['sessionId'];
    if (typeof sourceRef !== 'string' || sourceRef.length === 0) continue;
    const current = groups.get(sourceRef) ?? [];
    current.push(episode);
    groups.set(sourceRef, current);
  }
  return groups;
};

const NEGATION_MARKERS = ['avoid', 'never', 'must not', 'do not', 'deprecated', 'forbidden'];

const AFFIRMATION_MARKERS = ['use', 'should', 'must', 'recommended', 'allow', 'supported'];

export class Assimilator {
  constructor(private readonly graphStore: ContextGraphStore) {}

  run(options: MetabolismStageOptions = {}): MetabolismStageStats & { stage: MetabolismStage.ASSIMILATE } {
    const episodes = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.EPISODE,
      limit: 1000,
    });
    const groups = groupEpisodesBySource(episodes);
    const snapshots = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.SNAPSHOT,
      limit: 1000,
    });
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const [sourceRef, sourceEpisodes] of groups) {
      const existing = this.graphStore.listNodes({
        project: options.project,
        substrateType: SubstrateType.SNAPSHOT,
        sourceRef,
        limit: 1,
      })[0];
      if (existing) {
        skipped += sourceEpisodes.length;
        continue;
      }

      const content = sourceEpisodes.map((episode) => episode.content).join('\n\n');
      const entities = extractAssimilationEntities(sourceEpisodes, content);
      const overlap = findBestOverlap(content, snapshots);
      if (overlap && overlap.score >= 0.65 && !looksContradictory(content, overlap.node.content)) {
        for (const episode of sourceEpisodes) {
          this.graphStore.createEdge({
            sourceId: episode.id,
            targetId: overlap.node.id,
            relationType: ContextRelationType.SUPPORTS,
            strength: overlap.score,
            evidence: { sourceRef, lexicalOverlap: overlap.score, entities },
          });
        }
        updated++;
        skipped += sourceEpisodes.length;
        continue;
      }

      const snapshot = this.graphStore.createNode({
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.SESSION_SUMMARY,
        title: `Assimilated snapshot: ${sourceRef}`,
        content,
        tags: ['assimilated-snapshot'],
        project: options.project ?? sourceEpisodes[0]?.project,
        compressionLevel: 0.2,
        confidence: 0.75,
        qualityScore: 60,
        status: ContextNodeStatus.ACTIVE,
        sourceRef,
        metadata: {
          episodeIds: sourceEpisodes.map((episode) => episode.id),
          entities,
        },
      });

      for (const episode of sourceEpisodes) {
        this.graphStore.createEdge({
          sourceId: episode.id,
          targetId: snapshot.id,
          relationType: ContextRelationType.DERIVED_FROM,
          strength: 1,
          evidence: { sourceRef, entities },
        });
      }

      const contradiction = findBestOverlap(content, snapshots);
      if (contradiction && contradiction.score >= 0.5 && looksContradictory(content, contradiction.node.content)) {
        this.graphStore.createEdge({
          sourceId: snapshot.id,
          targetId: contradiction.node.id,
          relationType: ContextRelationType.CONTRADICTS,
          strength: contradiction.score,
          evidence: { sourceRef, lexicalOverlap: contradiction.score, entities },
        });
        this.graphStore.createEdge({
          sourceId: contradiction.node.id,
          targetId: snapshot.id,
          relationType: ContextRelationType.CONTRADICTS,
          strength: contradiction.score,
          evidence: { sourceRef, lexicalOverlap: contradiction.score, entities },
        });
        this.graphStore.updateNode(snapshot.id, { status: ContextNodeStatus.CONFLICTED });
        this.graphStore.updateNode(contradiction.node.id, { status: ContextNodeStatus.CONFLICTED });
        this.graphStore.createConflictRecord({
          project: snapshot.project ?? contradiction.node.project,
          nodeIds: [snapshot.id, contradiction.node.id],
          reason: `Assimilation found contradictory snapshots (${contradiction.score.toFixed(2)})`,
        });
        updated += 2;
      }
      created++;
    }

    return {
      stage: MetabolismStage.ASSIMILATE,
      scanned: episodes.length,
      created,
      updated,
      skipped,
    };
  }
}

function findBestOverlap(
  content: string,
  candidates: ContextNode[],
): { node: ContextNode; score: number } | null {
  let best: { node: ContextNode; score: number } | null = null;
  for (const node of candidates) {
    if (node.status === ContextNodeStatus.DEPRECATED || node.status === ContextNodeStatus.ARCHIVED) continue;
    const score = lexicalOverlap(content, node.content);
    if (!best || score > best.score) {
      best = { node, score };
    }
  }
  return best;
}

function lexicalOverlap(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let matches = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) matches++;
  }
  return matches / Math.min(aTokens.size, bTokens.size);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((token) => token.length > 2);
}

function looksContradictory(a: string, b: string): boolean {
  const aContent = a.toLowerCase();
  const bContent = b.toLowerCase();
  const aNegates = NEGATION_MARKERS.some((marker) => aContent.includes(marker));
  const bNegates = NEGATION_MARKERS.some((marker) => bContent.includes(marker));
  const aAffirms = AFFIRMATION_MARKERS.some((marker) => aContent.includes(marker));
  const bAffirms = AFFIRMATION_MARKERS.some((marker) => bContent.includes(marker));
  return (aNegates && bAffirms && !bNegates) || (bNegates && aAffirms && !aNegates);
}

function extractAssimilationEntities(
  episodes: ContextNode[],
  content: string,
): { files: string[]; modules: string[]; dependencies: string[]; errorCodes: string[]; errorTypes: string[] } {
  const metadataText = episodes.map((episode) => JSON.stringify(episode.metadata ?? {})).join('\n');
  const combined = `${content}\n${metadataText}`;
  const files = unique(combined.match(/\b[\w.-]+(?:\/[\w.@-]+)+\.[a-zA-Z0-9]+\b/g) ?? []);
  return {
    files,
    modules: unique(files.map(filePathToModuleName)),
    dependencies: unique(extractDependencies(combined)),
    errorCodes: unique(combined.match(/\b(?:TS|ERR|E)[0-9]{3,6}\b/g) ?? []),
    errorTypes: extractErrorTypes(combined),
  };
}

function extractDependencies(value: string): string[] {
  const common = ['react', 'next', 'typescript', 'vite', 'vitest', 'jest', 'express', 'fastify', 'sqlite', 'better-sqlite3'];
  const normalized = value.toLowerCase();
  return common.filter((dependency) => normalized.includes(dependency));
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function filePathToModuleName(filePath: string): string {
  return filePath
    .replace(/^src[\\/]/, '')
    .replace(/\.[^.]+$/, '');
}

function extractErrorTypes(value: string): string[] {
  const normalized = value.toLowerCase();
  const types: string[] = [];
  if (/\bts[0-9]{3,6}\b/.test(normalized) || normalized.includes('type error')) {
    types.push('type_error');
  }
  if (normalized.includes('hydration')) {
    types.push('hydration_error');
  }
  if (normalized.includes('timeout')) {
    types.push('timeout_error');
  }
  if (normalized.includes('connection') || normalized.includes('network')) {
    types.push('network_error');
  }
  if (normalized.includes('assertion') || normalized.includes('test failed')) {
    types.push('test_failure');
  }
  return unique(types);
}
