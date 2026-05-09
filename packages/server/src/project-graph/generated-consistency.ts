import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  isProjectGraphEdge,
  isProjectGraphNode,
  type ContextEdge,
  type ContextNode,
} from '@mindstrate/protocol/models';

export interface GeneratedEditSafetyInput {
  changedFiles: string[];
  nodes: ContextNode[];
  edges: ContextEdge[];
  generatedRoots?: string[];
}

export interface GeneratedEditSafetyIssue {
  code: 'generated-file-edited';
  severity: 'error';
  file: string;
  sourceOfTruthNodeId?: string;
  sourceOfTruthLabel?: string;
  sourceOfTruthFile?: string;
  message: string;
  evidence: string[];
}

export const checkGeneratedEditSafety = (input: GeneratedEditSafetyInput): GeneratedEditSafetyIssue[] => {
  const nodes = input.nodes.filter(isProjectGraphNode);
  const edges = input.edges.filter(isProjectGraphEdge);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const generatedFromTargetBySourceId = generatedFromTargets(edges);

  return input.changedFiles.flatMap((file) => {
    const normalizedFile = normalizePath(file);
    const generatedNode = nodes.find((node) => nodeMatchesFile(node, normalizedFile));
    if (!isGeneratedFile(normalizedFile, generatedNode, input.generatedRoots ?? [])) return [];
    const sourceNode = generatedNode
      ? nodesById.get(stringMetadata(generatedNode, 'sourceGeneratedFrom') ?? generatedFromTargetBySourceId.get(generatedNode.id) ?? '')
      : undefined;
    return [{
      code: 'generated-file-edited',
      severity: 'error',
      file: normalizedFile,
      sourceOfTruthNodeId: sourceNode?.id,
      sourceOfTruthLabel: sourceNode?.title,
      sourceOfTruthFile: sourceNode ? stringMetadata(sourceNode, PROJECT_GRAPH_METADATA_KEYS.ownedByFile) ?? sourceNode.sourceRef : undefined,
      message: sourceNode
        ? `${normalizedFile} is generated output. Edit source of truth ${sourceNode.title} (${stringMetadata(sourceNode, PROJECT_GRAPH_METADATA_KEYS.ownedByFile) ?? sourceNode.sourceRef ?? 'unknown source file'}) and regenerate.`
        : `${normalizedFile} is generated output. Identify the upstream source of truth and regenerate instead of editing it directly.`,
      evidence: evidencePaths([generatedNode, sourceNode].filter((node): node is ContextNode => !!node)),
    }];
  });
};

const generatedFromTargets = (edges: ContextEdge[]): Map<string, string> => {
  const targets = new Map<string, string>();
  for (const edge of edges) {
    if (edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] !== ProjectGraphEdgeKind.GENERATED_FROM) continue;
    targets.set(edge.sourceId, edge.targetId);
  }
  return targets;
};

const isGeneratedFile = (
  file: string,
  node: ContextNode | undefined,
  generatedRoots: string[],
): boolean =>
  node?.metadata?.['generated'] === true
  || node?.metadata?.['doNotEdit'] === true
  || generatedRoots.map(normalizePath).some((root) => file === root || file.startsWith(`${root}/`));

const nodeMatchesFile = (node: ContextNode, file: string): boolean =>
  normalizePath(node.title) === file
  || normalizePath(node.sourceRef ?? '') === file
  || normalizePath(String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.ownedByFile] ?? '')) === file;

const stringMetadata = (node: ContextNode, key: string): string | undefined =>
  typeof node.metadata?.[key] === 'string' ? String(node.metadata[key]) : undefined;

const evidencePaths = (nodes: ContextNode[]): string[] =>
  Array.from(new Set(nodes.flatMap((node) => {
    const evidence = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence];
    return Array.isArray(evidence)
      ? evidence.map((entry) => typeof entry?.path === 'string' ? entry.path : undefined).filter((value): value is string => !!value)
      : [];
  })));

const normalizePath = (value: string): string => value.replace(/\\/g, '/');
