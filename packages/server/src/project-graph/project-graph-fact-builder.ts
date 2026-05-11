/**
 * Project graph fact-builder primitives.
 *
 * Pure constructors for `ProjectGraphNodeDto` / `ProjectGraphEdgeDto` and the
 * deduplicating Map operations used by every extractor (generic source,
 * Unreal-specific, binding inference). Also classifier predicates that
 * describe what a file path means in build/asset terms — those live here so
 * `fileImpactMetadata` can stay in one place instead of being copied around
 * the per-language extractors.
 *
 * No project-graph-service.ts orchestration logic, no per-language fact
 * recipes — those belong in the service file or dedicated `*-fact-builder`
 * modules.
 */

import {
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  type EvidenceRef,
  type ProjectGraphEdgeDto,
  type ProjectGraphNodeDto,
} from '@mindstrate/protocol/models';
import type { DetectedProject } from '../project/index.js';
import {
  createProjectGraphEdgeId,
  createProjectGraphNodeId,
} from './node-id.js';
import type { ParserCapture } from './parser-adapter.js';
import type { ProjectGraphScanPlan } from './scanner.js';

// ============================================================
// Path classifiers
// ============================================================

export const isUnrealBuildFile = (filePath: string): boolean =>
  filePath.endsWith('.Build.cs') || filePath.endsWith('.Target.cs');

export const isUnrealManifestFile = (filePath: string): boolean =>
  filePath.endsWith('.uproject') || filePath.endsWith('.uplugin');

export const isUnrealConfigFile = (filePath: string): boolean =>
  filePath.endsWith('.ini') && (filePath.startsWith('Config/') || filePath.includes('/Config/'));

// ============================================================
// Tag / metadata helpers
// ============================================================

export const impactTags = (...tags: string[]): { impactTags: string[] } =>
  ({ impactTags: Array.from(new Set(tags)) });

/**
 * Default impact metadata for a file path. Encodes "what kind of risk does
 * editing this file carry" without inspecting file contents.
 */
export const fileImpactMetadata = (filePath: string): Record<string, unknown> => {
  if (isUnrealBuildFile(filePath)) {
    return {
      buildCritical: true,
      ...impactTags('build-critical'),
    };
  }
  if (isUnrealManifestFile(filePath)) {
    return {
      buildCritical: true,
      ...impactTags(filePath.endsWith('.uplugin') ? 'plugin-manifest' : 'project-manifest', 'build-critical'),
    };
  }
  if (isUnrealConfigFile(filePath)) {
    return {
      configSensitive: true,
      ...impactTags('config-sensitive'),
    };
  }
  if (filePath.startsWith('Content/') || filePath.includes('/Content/')) {
    return {
      assetReferenceSensitive: true,
      ...impactTags('asset-reference-sensitive'),
    };
  }
  return {};
};

export const generatedFileMetadata = (
  filePath: string,
  scanPlan: ProjectGraphScanPlan | undefined,
): Record<string, unknown> => {
  if (!scanPlan?.generatedRoots.some((root) => filePath === root || filePath.startsWith(`${root}/`))) return {};
  return {
    generated: true,
    doNotEdit: true,
    metadataOnly: true,
    ...impactTags('generated', 'do-not-edit'),
  };
};

// ============================================================
// Evidence helpers
// ============================================================

export const evidence = (filePath: string, capture?: ParserCapture): EvidenceRef[] => [{
  path: filePath,
  startLine: capture?.startLine,
  endLine: capture?.endLine,
  captureName: capture?.name,
  locationUnavailable: capture ? false : true,
  extractorId: capture?.extractorId ?? (capture ? 'tree-sitter-source' : 'project-graph-scanner'),
}];

export const longestMatchingRoot = (filePath: string, roots: string[]): string | undefined =>
  roots
    .filter((root) => filePath === root || filePath.startsWith(`${root}/`))
    .sort((left, right) => right.length - left.length)[0];

// ============================================================
// Node / edge constructors
// ============================================================

export const fileNodeId = (project: DetectedProject, filePath: string): string =>
  createProjectGraphNodeId({ project: project.name, kind: ProjectGraphNodeKind.FILE, key: filePath });

export const makeNode = (
  project: DetectedProject,
  kind: ProjectGraphNodeKind,
  key: string,
  label: string,
  nodeEvidence: EvidenceRef[],
  metadata?: Record<string, unknown>,
): ProjectGraphNodeDto => ({
  id: createProjectGraphNodeId({ project: project.name, kind, key }),
  kind,
  label,
  project: project.name,
  provenance: ProjectGraphProvenance.EXTRACTED,
  evidence: nodeEvidence,
  metadata,
});

export const makeFileNode = (
  project: DetectedProject,
  filePath: string,
  scanPlan?: ProjectGraphScanPlan,
): ProjectGraphNodeDto => makeNode(project, ProjectGraphNodeKind.FILE, filePath, filePath, evidence(filePath), {
  ownedByFile: filePath,
  ...fileImpactMetadata(filePath),
  ...generatedFileMetadata(filePath, scanPlan),
});

export const makeEdge = (
  sourceId: string,
  targetId: string,
  kind: ProjectGraphEdgeKind,
  edgeEvidence: EvidenceRef[],
  metadata?: Record<string, unknown>,
): ProjectGraphEdgeDto => ({
  id: createProjectGraphEdgeId({ sourceId, targetId, kind }),
  sourceId,
  targetId,
  kind,
  provenance: ProjectGraphProvenance.EXTRACTED,
  evidence: edgeEvidence,
  metadata,
});

// ============================================================
// De-duplicating Map operations
// ============================================================

export const addNode = (nodes: Map<string, ProjectGraphNodeDto>, node: ProjectGraphNodeDto): void => {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, node);
    return;
  }
  nodes.set(node.id, {
    ...existing,
    ...node,
    evidence: mergeEvidence(existing.evidence, node.evidence),
    metadata: {
      ...(existing.metadata ?? {}),
      ...(node.metadata ?? {}),
    },
  });
};

export const addEdge = (edges: Map<string, ProjectGraphEdgeDto>, edge: ProjectGraphEdgeDto): void => {
  edges.set(edge.id, edge);
};

const mergeEvidence = (left: EvidenceRef[], right: EvidenceRef[]): EvidenceRef[] => {
  const merged = new Map<string, EvidenceRef>();
  for (const ref of [...left, ...right]) {
    merged.set(JSON.stringify(ref), ref);
  }
  return Array.from(merged.values());
};

// ============================================================
// Tiny string helpers used by every extractor
// ============================================================

export const stripQuotes = (value: string): string => value.replace(/^['"]|['"]$/g, '');

export const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values));

export const normalizeSymbolName = (value: string): string =>
  value.replace(/[^a-z0-9]/gi, '').toLowerCase();

export const dependencyScopeFromCapture = (capture: ParserCapture): 'public' | 'private' =>
  capture.name.includes('.private-') ? 'private' : 'public';
