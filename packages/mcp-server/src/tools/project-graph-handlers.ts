import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  ProjectGraphOverlaySource,
  isProjectGraphEdge,
  isProjectGraphNode,
  type ContextEdge,
  type ContextNode,
  type ProjectGraphOverlay,
  type ProjectGraphOverlayKind,
} from '@mindstrate/protocol';
import type { McpApi, McpToolResponse } from '../types.js';
import {
  evidencePaths,
  formatProjectGraphEdges,
  formatProjectGraphNodes,
  formatProjectGraphOverlays,
} from './project-graph-render.js';

type ToolInput = any;

export async function handleProjectGraphQuery(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    query: input.query,
    project: input.project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: input.limit ?? 10,
  }));

  if (nodes.length === 0) {
    return { content: [{ type: 'text', text: 'No project graph nodes matched the query.' }] };
  }
  return { content: [{ type: 'text', text: formatProjectGraphNodes(nodes) }] };
}

export async function handleProjectGraphTaskQuery(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    project: input.project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }));
  const edges = projectGraphEdges(await api.listContextEdges({ limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT }));
  const query = typeof input.query === 'string' ? input.query.toLowerCase() : undefined;
  const matching = nodes.filter((node) => !query || node.title.toLowerCase().includes(query) || node.id.toLowerCase().includes(query));
  const selected = selectTaskNodes(input.task, nodes, edges, matching).slice(0, input.limit ?? 10);
  const evidence = Array.from(new Set(selected.flatMap(evidencePaths))).slice(0, input.limit ?? 10);
  if (input.task === 'before-edit' || input.task === 'impact') {
    const overlays = await api.listProjectGraphOverlays({ project: input.project, limit: 100 });
    const report = buildBeforeEditReport({
      task: input.task,
      query: input.query,
      nodes,
      edges,
      selected,
      evidence,
      overlays,
      limit: input.limit ?? 10,
    });
    return { content: [{ type: 'text', text: report }] };
  }
  const compactJson = {
    task: input.task,
    query: input.query,
    nodeIds: selected.map((node) => node.id),
    evidence,
    suggestedNextQueries: selected.slice(0, 3).map((node) => `impact ${node.title}`),
  };
  const text = [
    `### ${input.task}`,
    '',
    formatProjectGraphNodes(selected),
    '',
    '### Compact JSON',
    '```json',
    JSON.stringify(compactJson, null, 2),
    '```',
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphGetNode(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const node = await findProjectGraphNode(api, input.id, input.project);
  if (!node) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };
  return { content: [{ type: 'text', text: formatProjectGraphNodes([node]) }] };
}

export async function handleProjectGraphGetNeighbors(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const node = await findProjectGraphNode(api, input.id, input.project);
  if (!node) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };
  const limit = input.limit ?? 20;
  const outgoing = projectGraphEdges(await api.listContextEdges({ sourceId: node.id, limit }));
  const incoming = projectGraphEdges(await api.listContextEdges({ targetId: node.id, limit }));
  const text = [
    formatProjectGraphNodes([node]),
    '',
    '### Outgoing Edges',
    formatProjectGraphEdges(outgoing),
    '',
    '### Incoming Edges',
    formatProjectGraphEdges(incoming),
    '',
    'Suggested next queries:',
    `- explain_project_graph_node id="${node.id}"`,
    '- query_project_graph query="entry points"',
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphExplainNode(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const node = await findProjectGraphNode(api, input.id, input.project);
  if (!node) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };
  const outgoing = projectGraphEdges(await api.listContextEdges({ sourceId: node.id, limit: 20 }));
  const incoming = projectGraphEdges(await api.listContextEdges({ targetId: node.id, limit: 20 }));
  const overlays = await api.listProjectGraphOverlays({ project: node.project, targetNodeId: node.id, limit: 20 });
  const text = [
    `### ${node.title}`,
    `Kind: ${node.metadata?.['kind'] ?? 'unknown'}`,
    `Provenance: ${node.metadata?.['provenance'] ?? 'unknown'}`,
    `Evidence: ${evidencePaths(node).join(', ') || '(none)'}`,
    `Incoming project graph edges: ${incoming.length}`,
    `Outgoing project graph edges: ${outgoing.length}`,
    '',
    '### Overlays',
    formatProjectGraphOverlays(overlays),
    '',
    'Suggested next queries:',
    `- get_project_graph_neighbors id="${node.id}"`,
    `- query_project_graph query="${node.title}"`,
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphPath(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    project: input.project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }));
  const edges = projectGraphEdges(await api.listContextEdges({ limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT }));
  const path = shortestProjectGraphPath(nodes, edges, input.from, input.to, input.maxDepth ?? 6);
  if (!path) return { content: [{ type: 'text', text: 'No project graph path found.' }] };
  const text = [
    `Found project graph path with ${path.nodes.length} node(s).`,
    '',
    ...path.nodes.map((node, index) => [
      `### ${index + 1}. ${node.title}`,
      `ID: ${node.id}`,
      `Kind: ${node.metadata?.['kind'] ?? 'unknown'}`,
      path.edges[index] ? `Next edge: ${path.edges[index].evidence?.['kind'] ?? path.edges[index].relationType}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphBlastRadius(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    project: input.project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }));
  const edges = projectGraphEdges(await api.listContextEdges({ limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT }));
  const root = findProjectGraphNodeInList(nodes, input.id);
  if (!root) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };

  const affected = collectBlastRadius(nodes, edges, root.id, input.depth ?? 1, input.limit ?? 20);
  const text = [
    `### Blast Radius: ${root.title}`,
    `Affected nodes: ${affected.nodes.length}`,
    `Edges: ${affected.edges.length}`,
    '',
    formatProjectGraphNodes(affected.nodes),
    '',
    '### Connecting Edges',
    formatProjectGraphEdges(affected.edges),
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphAddOverlay(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const overlay = await api.createProjectGraphOverlay({
    project: input.project,
    target: input.target,
    targetNodeId: input.targetNodeId,
    targetEdgeId: input.targetEdgeId,
    kind: input.kind as ProjectGraphOverlayKind,
    content: input.content,
    author: input.author,
    source: input.source ?? ProjectGraphOverlaySource.MCP,
  });

  return {
    content: [{
      type: 'text',
      text: [
        'Project graph overlay added.',
        `ID: ${overlay.id}`,
        `Project: ${overlay.project}`,
        overlay.target ? `Target: ${overlay.target}` : null,
        overlay.targetNodeId ? `Target node: ${overlay.targetNodeId}` : null,
        overlay.targetEdgeId ? `Target edge: ${overlay.targetEdgeId}` : null,
        `Kind: ${overlay.kind}`,
        `Source: ${overlay.source}`,
      ].filter(Boolean).join('\n'),
    }],
  };
}

const findProjectGraphNode = async (
  api: McpApi,
  id: string,
  project?: string,
): Promise<ContextNode | null> => {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }));
  return findProjectGraphNodeInList(nodes, id) ?? null;
};

const projectGraphNodes = (nodes: ContextNode[]): ContextNode[] =>
  nodes.filter(isProjectGraphNode);

const projectGraphEdges = (edges: ContextEdge[]): ContextEdge[] =>
  edges.filter(isProjectGraphEdge);

const findProjectGraphNodeInList = (nodes: ContextNode[], id: string): ContextNode | undefined =>
  nodes.find((node) => node.id === id || node.title === id || node.sourceRef === id);

interface ProjectGraphTaskReportInput {
  task: string;
  query: unknown;
  nodes: ContextNode[];
  edges: ContextEdge[];
  selected: ContextNode[];
  evidence: string[];
  overlays: ProjectGraphOverlay[];
  limit: number;
}

interface ProjectGraphTaskReport {
  classifications: string[];
  constraints: string[];
  affectedChains: string[];
  sourceOfTruth: string[];
  doNotEdit: string[];
  requiredSearches: string[];
  recommendedVerification: string[];
  safetyIssues: ProjectGraphSafetyIssue[];
  overlays: ProjectGraphOverlay[];
}

interface ProjectGraphSafetyIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  evidence: string[];
}

const GENERATED_ROOTS = [
  'Binaries',
  'Intermediate',
  'Saved',
  'DerivedDataCache',
  'TypeScript/Typing',
];

const buildBeforeEditReport = (input: ProjectGraphTaskReportInput): string => {
  const report = analyzeProjectGraphTask(input);
  const compactJson = {
    task: input.task,
    query: input.query,
    classifications: report.classifications,
    nodeIds: input.selected.map((node) => node.id),
    evidence: input.evidence,
    sourceOfTruth: report.sourceOfTruth,
    doNotEdit: report.doNotEdit,
    safetyIssues: report.safetyIssues,
    requiredSearches: report.requiredSearches,
    recommendedVerification: report.recommendedVerification,
    suggestedNextQueries: input.selected.slice(0, 3).map((node) => `impact ${node.title}`),
  };
  return [
    `### ${input.task === 'impact' ? 'Impact Report' : 'Before Edit Report'}`,
    '',
    `Target: ${typeof input.query === 'string' && input.query.length > 0 ? input.query : '(not specified)'}`,
    '',
    '### Classification',
    formatList(report.classifications),
    '',
    '### Known Constraints',
    formatList(report.constraints),
    '',
    '### Affected Chains',
    formatList(report.affectedChains),
    '',
    '### Source Of Truth',
    formatList(report.sourceOfTruth),
    '',
    '### Do Not Edit Directly',
    formatList(report.doNotEdit),
    '',
    '### Required Searches Before Editing',
    formatList(report.requiredSearches),
    '',
    '### Recommended Verification',
    formatList(report.recommendedVerification),
    '',
    '### Safety Issues',
    formatSafetyIssues(report.safetyIssues),
    '',
    '### Relevant Overlays',
    formatProjectGraphOverlays(report.overlays),
    '',
    '### Matching Nodes',
    formatProjectGraphNodes(input.selected),
    '',
    '### Compact JSON',
    '```json',
    JSON.stringify(compactJson, null, 2),
    '```',
  ].join('\n');
};

const analyzeProjectGraphTask = (input: ProjectGraphTaskReportInput): ProjectGraphTaskReport => {
  const targetText = collectTargetText(input);
  const classifications = classifyTargets(input.selected, targetText);
  const overlays = relevantOverlays(input.overlays, targetText).slice(0, input.limit);
  return {
    classifications,
    constraints: taskConstraints(classifications),
    affectedChains: affectedChains(classifications),
    sourceOfTruth: sourceOfTruth(classifications),
    doNotEdit: doNotEditTargets(classifications),
    requiredSearches: requiredSearches(classifications),
    recommendedVerification: recommendedVerification(classifications),
    safetyIssues: collectSafetyIssues(input.nodes, input.edges, input.selected, targetText),
    overlays,
  };
};

const collectSafetyIssues = (
  nodes: ContextNode[],
  edges: ContextEdge[],
  selected: ContextNode[],
  targetText: string[],
): ProjectGraphSafetyIssue[] => {
  const selectedIds = new Set(selected.map((node) => node.id));
  const issues = [
    ...generatedOutputIssues(selected, targetText),
    ...pluginDependencyIssues(nodes, edges, selectedIds),
    ...moduleBoundaryIssues(nodes, edges, selectedIds),
  ];
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const generatedOutputIssues = (selected: ContextNode[], targetText: string[]): ProjectGraphSafetyIssue[] => {
  const targetPaths = targetText.map((value) => value.replace(/\\/g, '/'));
  const generatedTargets = selected.filter((node) => node.metadata?.['generated'] === true || node.metadata?.['doNotEdit'] === true);
  const generatedPathTargets = targetPaths.filter((value) => GENERATED_ROOTS.some((root) => value === root || value.startsWith(`${root}/`) || value.includes(`/${root}/`)));
  if (generatedTargets.length === 0 && generatedPathTargets.length === 0) return [];
  return [{
    code: 'generated-output-targeted',
    severity: 'error',
    message: 'The target includes generated output. Identify and edit the upstream source of truth, then regenerate instead of editing it directly.',
    evidence: uniqueStrings([...generatedTargets.flatMap(evidencePaths), ...generatedPathTargets]),
  }];
};

const pluginDependencyIssues = (
  nodes: ContextNode[],
  edges: ContextEdge[],
  selectedIds: Set<string>,
): ProjectGraphSafetyIssue[] => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const modulesByName = new Map(nodes
    .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphNodeKind.MODULE && node.metadata?.['unrealModule'] === true)
    .map((node) => [node.title, node]));
  const declaredPlugins = collectDeclaredPluginDependencies(nodesById, edges);
  return edges.flatMap((edge) => {
    if (!isUnrealModuleDependencyEdge(edge)) return [];
    if (!selectedIds.has(edge.sourceId) && !selectedIds.has(edge.targetId)) return [];
    const sourceModule = nodesById.get(edge.sourceId);
    const dependency = nodesById.get(edge.targetId);
    if (!sourceModule || !dependency || sourceModule.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] !== ProjectGraphNodeKind.MODULE) return [];
    const sourcePlugin = pluginNameForPath(stringMetadata(sourceModule, 'declaredIn'));
    const targetModule = modulesByName.get(dependency.title);
    const targetPlugin = pluginNameForPath(stringMetadata(targetModule, 'declaredIn'));
    if (!sourcePlugin || !targetPlugin || sourcePlugin === targetPlugin) return [];
    if (declaredPlugins.get(sourcePlugin)?.dependencies.has(targetPlugin)) return [];
    return [{
      code: 'missing-plugin-dependency',
      severity: 'error' as const,
      message: `${sourcePlugin} module ${sourceModule.title} depends on ${dependency.title}, but ${sourcePlugin}.uplugin does not declare plugin dependency ${targetPlugin}.`,
      evidence: uniqueStrings([...evidencePaths(sourceModule), ...evidencePaths(dependency), ...(targetModule ? evidencePaths(targetModule) : [])]),
    }];
  });
};

const moduleBoundaryIssues = (
  nodes: ContextNode[],
  edges: ContextEdge[],
  selectedIds: Set<string>,
): ProjectGraphSafetyIssue[] => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const modulesByName = new Map(nodes
    .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphNodeKind.MODULE && node.metadata?.['unrealModule'] === true)
    .map((node) => [node.title, node]));
  return edges.flatMap((edge) => {
    if (!isUnrealModuleDependencyEdge(edge)) return [];
    if (!selectedIds.has(edge.sourceId) && !selectedIds.has(edge.targetId)) return [];
    const sourceModule = nodesById.get(edge.sourceId);
    const dependency = nodesById.get(edge.targetId);
    const targetModule = dependency ? modulesByName.get(dependency.title) : undefined;
    if (!sourceModule || !targetModule) return [];
    const sourceType = stringMetadata(sourceModule, 'moduleType');
    const targetType = stringMetadata(targetModule, 'moduleType');
    if (isEditorOnlyModuleType(sourceType) || !isEditorOnlyModuleType(targetType)) return [];
    return [{
      code: 'runtime-depends-on-editor-module',
      severity: 'error' as const,
      message: `${sourceModule.title} (${sourceType ?? 'unknown module type'}) depends on editor-only module ${targetModule.title}. Runtime modules must not depend on Editor modules.`,
      evidence: uniqueStrings([...evidencePaths(sourceModule), ...evidencePaths(targetModule)]),
    }];
  });
};

const collectDeclaredPluginDependencies = (
  nodesById: Map<string, ContextNode>,
  edges: ContextEdge[],
): Map<string, { dependencies: Set<string> }> => {
  const declared = new Map<string, { dependencies: Set<string> }>();
  for (const edge of edges) {
    if (edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] !== ProjectGraphEdgeKind.DEPENDS_ON) continue;
    if (edge.evidence?.['dependencyKind'] !== 'unreal-plugin') continue;
    const source = nodesById.get(edge.sourceId);
    const target = nodesById.get(edge.targetId);
    const plugin = source ? pluginNameForPath(source.title) : undefined;
    if (!plugin || !target) continue;
    const entry = declared.get(plugin) ?? { dependencies: new Set<string>() };
    entry.dependencies.add(target.title);
    declared.set(plugin, entry);
  }
  return declared;
};

const isUnrealModuleDependencyEdge = (edge: ContextEdge): boolean =>
  edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.DEPENDS_ON
  && edge.evidence?.['dependencyKind'] === 'unreal-module';

const stringMetadata = (node: ContextNode | undefined, key: string): string =>
  typeof node?.metadata?.[key] === 'string' ? String(node.metadata[key]) : '';

const isEditorOnlyModuleType = (moduleType: string): boolean =>
  moduleType.toLowerCase().includes('editor');

const pluginNameForPath = (filePath: string): string | undefined =>
  filePath.replace(/\\/g, '/').match(/^Plugins\/([^/]+)\//)?.[1];

const collectTargetText = (input: ProjectGraphTaskReportInput): string[] => uniqueStrings([
  typeof input.query === 'string' ? input.query : undefined,
  ...input.evidence,
  ...input.selected.flatMap((node) => [node.id, node.title, node.sourceRef, ...evidencePaths(node)]),
]);

const classifyTargets = (nodes: ContextNode[], targetText: string[]): string[] => {
  const lower = targetText.map((value) => value.replace(/\\/g, '/').toLowerCase());
  const has = (predicate: (value: string) => boolean): boolean => lower.some(predicate);
  const classes = new Set<string>();
  if (nodes.some((node) => node.metadata?.['generated'] === true || node.metadata?.['doNotEdit'] === true)
    || GENERATED_ROOTS.some((root) => has((value) => value === root.toLowerCase() || value.startsWith(`${root.toLowerCase()}/`) || value.includes(`/${root.toLowerCase()}/`)))) {
    classes.add('generated-output');
  }
  if (has((value) => value.endsWith('.uproject'))) classes.add('project-manifest');
  if (has((value) => value.endsWith('.uplugin'))) classes.add('plugin-manifest');
  if (has((value) => value.endsWith('.build.cs'))) classes.add('build-module');
  if (has((value) => value.includes('/config/') || value.endsWith('.ini'))) classes.add('config-sensitive');
  if (has((value) => value.includes('/content/'))) classes.add('asset-reference-sensitive');
  if (has((value) => value.includes('/typescript/') || value.endsWith('.ts') || value.endsWith('.tsx'))) classes.add('typescript-consumer');
  if (has((value) => value.includes('/source/') && (value.endsWith('.h') || value.endsWith('.cpp')))
    || nodes.some((node) => node.metadata?.['kind'] === ProjectGraphNodeKind.CLASS || node.metadata?.['kind'] === ProjectGraphNodeKind.TYPE || node.metadata?.['kind'] === ProjectGraphNodeKind.FUNCTION)) {
    classes.add('cpp-source');
  }
  if (nodes.some(hasUnrealReflectionEvidence)
    || has((value) => /\bu(class|struct|enum|function|property)\b/.test(value))) {
    classes.add('native-script-binding');
  }
  if (has((value) => value.includes('editor'))) classes.add('editor-boundary');
  if (classes.size === 0) classes.add('general-source');
  return Array.from(classes);
};

const taskConstraints = (classifications: string[]): string[] => {
  const values = new Set<string>();
  if (classifications.includes('generated-output')) values.add('Generated outputs are not source of truth; identify and edit the upstream source before changing them.');
  if (classifications.includes('plugin-manifest') || classifications.includes('project-manifest')) values.add('Project and plugin manifests control enabled plugins, module type, and load phase; treat them as high-impact changes.');
  if (classifications.includes('build-module')) values.add('Build.cs changes can alter public/private module dependencies and Runtime/Editor boundaries.');
  if (classifications.includes('editor-boundary')) values.add('Runtime modules must not depend on editor-only modules.');
  if (classifications.includes('asset-reference-sensitive')) values.add('Content asset paths may be referenced by soft or hard references; do not rename as plain files.');
  if (classifications.includes('native-script-binding')) values.add('Generated TypeScript declarations must be driven by C++ reflection metadata or generator configuration.');
  return Array.from(values);
};

const affectedChains = (classifications: string[]): string[] => {
  const values = new Set<string>();
  if (classifications.includes('native-script-binding')) values.add('C++ UCLASS/USTRUCT/UENUM/UFUNCTION/UPROPERTY -> UHT reflection -> UnrealSharp generator -> TypeScript/Typing -> TypeScript consumers.');
  if (classifications.includes('plugin-manifest') || classifications.includes('build-module') || classifications.includes('project-manifest')) values.add('.uproject/.uplugin -> module declaration -> Build.cs dependencies -> module load phase -> runtime/editor target.');
  if (classifications.includes('config-sensitive')) values.add('Config .ini -> class/module/plugin settings -> runtime/editor startup -> C++/script consumers.');
  if (classifications.includes('asset-reference-sensitive')) values.add('Content asset path -> soft/hard references -> configs/blueprints/assets -> runtime load.');
  if (classifications.includes('typescript-consumer')) values.add('TypeScript source -> generated declarations/imports -> UnrealSharp runtime binding -> native API.');
  if (values.size === 0) values.add('Target file -> direct imports/callers -> owning module -> validation command.');
  return Array.from(values);
};

const sourceOfTruth = (classifications: string[]): string[] => {
  const values = new Set<string>();
  if (classifications.includes('generated-output') || classifications.includes('native-script-binding')) {
    values.add('C++ reflection source and UnrealSharp generator/configuration.');
  }
  if (classifications.includes('plugin-manifest')) values.add('.uplugin module and plugin dependency declarations.');
  if (classifications.includes('project-manifest')) values.add('.uproject enabled plugin and project module declarations.');
  if (classifications.includes('build-module')) values.add('Owning *.Build.cs and corresponding .uplugin module metadata.');
  if (classifications.includes('config-sensitive')) values.add('Config source plus the C++ class or subsystem that reads it.');
  if (classifications.includes('asset-reference-sensitive')) values.add('Unreal asset registry, source asset, and Unreal-aware rename/reference tooling.');
  if (values.size === 0) values.add('Exact source file and its direct callers/importers.');
  return Array.from(values);
};

const doNotEditTargets = (classifications: string[]): string[] => {
  const values = new Set<string>();
  if (classifications.includes('generated-output') || classifications.includes('native-script-binding')) {
    for (const root of GENERATED_ROOTS) values.add(root);
  }
  if (classifications.includes('asset-reference-sensitive')) values.add('Content asset paths through plain filesystem rename.');
  return Array.from(values);
};

const requiredSearches = (classifications: string[]): string[] => {
  const values = new Set<string>(['direct callers/importers of the target']);
  if (classifications.includes('native-script-binding') || classifications.includes('generated-output')) {
    values.add('corresponding generated TypeScript declaration');
    values.add('TypeScript consumers of the native API');
    values.add('UnrealSharp generator/configuration entries');
  }
  if (classifications.includes('build-module') || classifications.includes('plugin-manifest') || classifications.includes('project-manifest')) {
    values.add('owning .uplugin and .uproject declarations');
    values.add('public/private Build.cs dependency users');
    values.add('Runtime versus Editor module boundaries');
  }
  if (classifications.includes('config-sensitive')) values.add('Config readers and referenced class/module/plugin names');
  if (classifications.includes('asset-reference-sensitive')) values.add('Asset Registry soft/hard references and config/blueprint references');
  return Array.from(values);
};

const recommendedVerification = (classifications: string[]): string[] => {
  const values = new Set<string>();
  if (classifications.includes('cpp-source') || classifications.includes('native-script-binding') || classifications.includes('build-module')) values.add('Unreal build compile for the affected target.');
  if (classifications.includes('native-script-binding') || classifications.includes('generated-output')) values.add('Run UnrealSharp/type generation and inspect generated declarations.');
  if (classifications.includes('typescript-consumer') || classifications.includes('native-script-binding')) values.add('Run TypeScript type check or the project script validation.');
  if (classifications.includes('plugin-manifest') || classifications.includes('project-manifest')) values.add('Validate editor/runtime startup with the changed plugin set.');
  if (classifications.includes('asset-reference-sensitive')) values.add('Run Unreal-aware asset reference validation.');
  if (classifications.includes('config-sensitive')) values.add('Run config load/startup validation for the affected target.');
  if (values.size === 0) values.add('Run the smallest build/test command covering the changed module.');
  return Array.from(values);
};

const relevantOverlays = (overlays: ProjectGraphOverlay[], targetText: string[]): ProjectGraphOverlay[] => {
  const lowerTargets = targetText.map((value) => value.toLowerCase());
  return overlays.filter((overlay) => {
    const target = overlay.target ?? overlay.targetNodeId ?? overlay.targetEdgeId;
    if (!target) return true;
    const lowerTarget = target.toLowerCase();
    return lowerTargets.some((value) => value.includes(lowerTarget) || lowerTarget.includes(value));
  });
};

const hasUnrealReflectionEvidence = (node: ContextNode): boolean => {
  const evidence = node.metadata?.['evidence'];
  return Array.isArray(evidence) && evidence.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const extractorId = 'extractorId' in entry ? String(entry.extractorId) : '';
    const captureName = 'captureName' in entry ? String(entry.captureName) : '';
    return extractorId === 'unreal-cpp-reflection' || captureName.startsWith('unreal.');
  });
};

const formatList = (values: string[]): string =>
  values.length === 0 ? '- None' : values.map((value) => `- ${value}`).join('\n');

const formatSafetyIssues = (issues: ProjectGraphSafetyIssue[]): string =>
  issues.length === 0
    ? '- None'
    : issues.map((issue) => [
      `- [${issue.severity}] ${issue.code}: ${issue.message}`,
      issue.evidence.length > 0 ? `  Evidence: ${issue.evidence.join(', ')}` : undefined,
    ].filter(Boolean).join('\n')).join('\n');

const uniqueStrings = (values: Array<string | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)));

const selectTaskNodes = (
  task: string,
  nodes: ContextNode[],
  edges: ContextEdge[],
  matching: ContextNode[],
): ContextNode[] => {
  if (task === 'entry-points') return nodes.filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphNodeKind.FILE && node.metadata?.['generated'] !== true);
  if (task === 'binding') return matching.filter((node) => edges.some((edge) =>
    edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.BINDS_TO && (edge.sourceId === node.id || edge.targetId === node.id)));
  if (task === 'asset-references') return relatedByEdgeKinds(matching, nodes, edges, [ProjectGraphEdgeKind.REFERENCES_ASSET, ProjectGraphEdgeKind.OWNS_ASSET]);
  if (task === 'flow') return relatedByEdgeKinds(matching, nodes, edges, [ProjectGraphEdgeKind.ENTRYPOINT_TO, ProjectGraphEdgeKind.CALLS, ProjectGraphEdgeKind.BINDS_TO, ProjectGraphEdgeKind.IMPORTS], 2);
  if (task === 'impact' || task === 'before-edit') return collectRelatedNodes(nodes, edges, matching, 2);
  return collectRelatedNodes(nodes, edges, matching, 1);
};

const relatedByEdgeKinds = (
  seeds: ContextNode[],
  nodes: ContextNode[],
  edges: ContextEdge[],
  kinds: ProjectGraphEdgeKind[],
  depth = 1,
): ContextNode[] => collectRelatedNodes(nodes, edges.filter((edge) => kinds.includes(edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] as ProjectGraphEdgeKind)), seeds, depth);

const collectRelatedNodes = (
  nodes: ContextNode[],
  edges: ContextEdge[],
  seeds: ContextNode[],
  depth: number,
): ContextNode[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selected = new Set(seeds.map((node) => node.id));
  const queue = seeds.map((node) => ({ id: node.id, depth: 0 }));
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= depth) continue;
    for (const edge of adjacentProjectGraphEdges(edges, current.id)) {
      const nextId = edge.sourceId === current.id ? edge.targetId : edge.sourceId;
      if (selected.has(nextId) || !byId.has(nextId)) continue;
      selected.add(nextId);
      queue.push({ id: nextId, depth: current.depth + 1 });
    }
  }
  return nodes.filter((node) => selected.has(node.id));
};

const shortestProjectGraphPath = (
  nodes: ContextNode[],
  edges: ContextEdge[],
  from: string,
  to: string,
  maxDepth: number,
): { nodes: ContextNode[]; edges: ContextEdge[] } | null => {
  const start = findProjectGraphNodeInList(nodes, from);
  const target = findProjectGraphNodeInList(nodes, to);
  if (!start || !target) return null;
  if (start.id === target.id) return { nodes: [start], edges: [] };

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set([start.id]);
  const queue: Array<{ id: string; nodeIds: string[]; edges: ContextEdge[] }> = [{
    id: start.id,
    nodeIds: [start.id],
    edges: [],
  }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.edges.length >= maxDepth) continue;
    for (const edge of adjacentProjectGraphEdges(edges, current.id)) {
      const nextId = edge.sourceId === current.id ? edge.targetId : edge.sourceId;
      if (seen.has(nextId) || !byId.has(nextId)) continue;
      const nodeIds = [...current.nodeIds, nextId];
      const pathEdges = [...current.edges, edge];
      if (nextId === target.id) {
        return { nodes: nodeIds.map((id) => byId.get(id)!), edges: pathEdges };
      }
      seen.add(nextId);
      queue.push({ id: nextId, nodeIds, edges: pathEdges });
    }
  }

  return null;
};

const collectBlastRadius = (
  nodes: ContextNode[],
  edges: ContextEdge[],
  rootId: string,
  depth: number,
  limit: number,
): { nodes: ContextNode[]; edges: ContextEdge[] } => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set([rootId]);
  const affected: ContextNode[] = [];
  const edgeById = new Map<string, ContextEdge>();
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  while (queue.length > 0 && affected.length < limit) {
    const current = queue.shift()!;
    if (current.depth >= depth) continue;
    for (const edge of adjacentProjectGraphEdges(edges, current.id)) {
      edgeById.set(edge.id, edge);
      const nextId = edge.sourceId === current.id ? edge.targetId : edge.sourceId;
      const next = byId.get(nextId);
      if (!next || seen.has(nextId)) continue;
      seen.add(nextId);
      affected.push(next);
      if (affected.length >= limit) break;
      queue.push({ id: nextId, depth: current.depth + 1 });
    }
  }
  return { nodes: affected, edges: Array.from(edgeById.values()) };
};

const adjacentProjectGraphEdges = (edges: ContextEdge[], nodeId: string): ContextEdge[] =>
  edges.filter((edge) => edge.sourceId === nodeId || edge.targetId === nodeId);
