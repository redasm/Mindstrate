import {
  PROJECT_GRAPH_METADATA_KEYS,
  type ChangeSet,
  type ContextEdge,
  type ContextNode,
  type ProjectGraphOverlay,
  type ProjectionRecord,
} from '@mindstrate/server';
import { truncateText as truncate } from '@mindstrate/server';

export const buildGraphStatusLines = (input: {
  mode: 'local' | 'team';
  project: string;
  nodes: number;
  edges: number;
  projections: ProjectionRecord[];
}): string[] => [
  'Project graph status',
  `  Project: ${input.project}`,
  `  Canonical: ${input.mode === 'team' ? 'Team Server shared graph' : 'local ECS graph'}`,
  `  Nodes: ${input.nodes}`,
  `  Edges: ${input.edges}`,
  '  Projections:',
  ...(input.projections.length > 0
    ? input.projections.map((record) => `    - ${record.target}: ${record.targetRef}`)
    : ['    - none']),
];

export const buildGraphOverlayLines = (overlays: ProjectGraphOverlay[]): string[] => [
  `Overlays: ${overlays.length}`,
  ...(overlays.length > 0
    ? overlays.flatMap((overlay) => [
      `  - [${overlay.kind}] ${overlay.content}`,
      `    Source: ${overlay.source} | Author: ${overlay.author ?? '(unknown)'} | ID: ${overlay.id}`,
    ])
    : ['  - none']),
];

export const buildGraphChangeResultLines = (result: {
  changeSet: ChangeSet;
  affectedNodeIds: string[];
  affectedLayers: string[];
  riskHints: string[];
  suggestedQueries: string[];
}): string[] => [
  `Source: ${result.changeSet.source}`,
  `Files: ${result.changeSet.files.length}`,
  `Affected nodes: ${result.affectedNodeIds.length}`,
  `Affected layers: ${result.affectedLayers.join(', ') || '(none)'}`,
  ...(result.riskHints.length > 0
    ? ['', 'Risk hints:', ...result.riskHints.map((hint) => `  - ${hint}`)]
    : []),
  '',
  'Suggested queries:',
  ...result.suggestedQueries.map((query) => `  - ${query}`),
];

export const buildGraphEvaluationDatasetExportLines = (input: {
  reportPath: string;
  fixturesDir: string;
  fixtureCount: number;
  taskCount: number;
}): string[] => [
  'Project graph evaluation dataset exported',
  `  Report: ${input.reportPath}`,
  `  Fixtures: ${input.fixturesDir}`,
  `  Fixture count: ${input.fixtureCount}`,
  `  Task count: ${input.taskCount}`,
];

export const printNodes = (nodes: ContextNode[], verbose: boolean): void => {
  if (nodes.length === 0) {
    console.log('No project graph nodes matched.');
    return;
  }
  for (const node of nodes) {
    console.log(`[${node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? 'node'}] ${node.title}`);
    console.log(`  ID: ${node.id}`);
    console.log(`  Provenance: ${node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.provenance] ?? 'unknown'}`);
    console.log(`  Evidence: ${evidencePaths(node).join(', ') || '(none)'}`);
    console.log(`  Content: ${verbose ? node.content : truncate(node.content, 120)}`);
    console.log('');
  }
};

export const printOverlays = (overlays: ProjectGraphOverlay[]): void => {
  for (const line of buildGraphOverlayLines(overlays)) console.log(line);
  console.log('');
};

export const printEdges = (label: string, edges: ContextEdge[]): void => {
  console.log(`${label}: ${edges.length}`);
  for (const edge of edges) {
    console.log(`  ${edge.relationType}: ${edge.sourceId} -> ${edge.targetId}`);
  }
};

export const printPath = (nodes: ContextNode[], edges: ContextEdge[]): void => {
  console.log(`Path nodes: ${nodes.length}`);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    console.log(`  ${index + 1}. [${node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? 'node'}] ${node.title}`);
    const edge = edges[index];
    if (edge) console.log(`     ${edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? edge.relationType}`);
  }
};

export const printCounts = (label: string, counts: Record<string, number>): void => {
  console.log(`\n${label}:`);
  for (const [key, count] of Object.entries(counts).sort()) console.log(`  ${key}: ${count}`);
};

export const countBy = <T>(items: T[], keyFor: (item: T) => string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

const evidencePaths = (node: ContextNode): string[] => {
  const evidence = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence];
  return Array.isArray(evidence)
    ? evidence.map((entry) => typeof entry === 'object' && entry && 'path' in entry ? String(entry.path) : '')
      .filter(Boolean)
    : [];
};
