import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphOverlayKind,
  type ContextNode,
  type ProjectGraphOverlay,
} from '@mindstrate/protocol/models';

export const listOrFallback = (items: string[]): string[] =>
  items.length > 0 ? items.map((item) => `- ${item}`) : ['- None detected yet.'];

export const scoreFirstFile = (filePath: string): number => {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  let score = 0;
  if (normalized.includes('/index.')) score += 60;
  if (normalized.includes('/main.')) score += 55;
  if (normalized.includes('/app.')) score += 50;
  if (normalized.startsWith('src/')) score += 40;
  if (normalized.endsWith('package.json') || normalized.endsWith('.uproject') || normalized.endsWith('.uplugin')) score += 30;
  if (normalized.endsWith('.build.cs') || normalized.endsWith('.target.cs')) score += 25;
  if (normalized.endsWith('readme.md')) score -= 20;
  return score;
};

export const preserveProjectGraphBlock = (text: string, name: string): string => {
  const start = `<!-- mindstrate:project-graph:${name}:start -->`;
  const end = `<!-- mindstrate:project-graph:${name}:end -->`;
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return '';
  return text.slice(startIndex + start.length, endIndex).trim();
};

export const slugifyProjectGraphValue = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';

export const evidencePathsForNode = (node: ContextNode): string[] => {
  const evidence = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence];
  return Array.isArray(evidence)
    ? evidence
      .map(formatEvidenceLocation)
      .filter(Boolean)
    : [];
};

export const overlaySections = (overlays: ProjectGraphOverlay[]): string[] => [
  ...overlayLines('User Corrections', overlays, ProjectGraphOverlayKind.CORRECTION),
  ...overlayLines('User Risks', overlays, ProjectGraphOverlayKind.RISK),
  ...overlayLines('User Conventions', overlays, ProjectGraphOverlayKind.CONVENTION),
  ...overlayLines('User Confirmations', overlays, ProjectGraphOverlayKind.CONFIRMATION),
].filter((line, index, lines) => line.length > 0 || lines[index - 1]?.startsWith('## '));

const overlayLines = (
  title: string,
  overlays: ProjectGraphOverlay[],
  kind: ProjectGraphOverlayKind,
): string[] => {
  const matching = overlays.filter((overlay) => overlay.kind === kind);
  if (matching.length === 0) return [];
  return [
    `## ${title}`,
    '',
    ...matching.flatMap((overlay) => [
      `- ${overlay.content}`,
      ...(overlay.target ? [`  - Target: ${overlay.target}`] : []),
      ...(overlay.targetNodeId ? [`  - Target node: ${overlay.targetNodeId}`] : []),
      ...(overlay.targetEdgeId ? [`  - Target edge: ${overlay.targetEdgeId}`] : []),
    ]),
    '',
  ];
};

const formatEvidenceLocation = (entry: unknown): string => {
  if (!entry || typeof entry !== 'object' || !('path' in entry)) return '';
  const record = entry as Record<string, unknown>;
  const evidencePath = String(record.path);
  if (typeof record.startLine !== 'number') return evidencePath;
  if (typeof record.endLine === 'number' && record.endLine !== record.startLine) {
    return `${evidencePath}:${record.startLine}-${record.endLine}`;
  }
  return `${evidencePath}:${record.startLine}`;
};

export const countBy = <T>(items: T[], keyFor: (item: T) => string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};
