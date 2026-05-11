/**
 * Project graph 'task report' machinery.
 * Supports the efore-edit and impact task variants of the
 * query_project_graph_task MCP tool: classifies the user-named target,
 * surfaces relevant overlays, computes safety issues, and renders a
 * deterministic Markdown report plus a compact JSON twin.
 *
 * Lifted from project-graph-handlers.ts so the handler file can stay a
 * thin dispatch layer.
 */

import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  type ContextEdge,
  type ContextNode,
  type ProjectGraphOverlay,
} from '@mindstrate/protocol';
import {
  evidencePaths,
  formatProjectGraphNodes,
  formatProjectGraphOverlays,
} from './project-graph-render.js';
import {
  collectRelatedNodes,
  relatedByEdgeKinds,
} from './project-graph-handler-utils.js';

interface ProjectGraphTaskReportInput {
  task: string;
  query: unknown;
  nodes: ContextNode[];
  edges: ContextEdge[];
  selected: ContextNode[];
  evidence: string[];
  overlays: ProjectGraphOverlay[];
  /**
   * Architecture system-page RULE nodes (produced by
   * `internalize-system-pages.ts` in the server package). When present,
   * their structured metadata seeds project-specific "Known Constraints",
   * "Do Not Edit Directly", "Affected Chains" and "Recommended
   * Verification" lines, which take precedence over the generic
   * fallbacks computed from `classifications` alone.
   */
  systemPageRules?: ContextNode[];
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

export const buildBeforeEditReport = (input: ProjectGraphTaskReportInput): string => {
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
  const fromSystemPages = collectSystemPageContributions(input.systemPageRules ?? [], classifications);
  // System-page metadata wins (project-specific guidance comes first), then
  // generic fallbacks fill any classification the project hasn't documented.
  return {
    classifications,
    constraints: mergeUnique(fromSystemPages.knownConstraints, taskConstraints(classifications)),
    affectedChains: mergeUnique(fromSystemPages.affectedChains, affectedChains(classifications)),
    sourceOfTruth: sourceOfTruth(classifications),
    doNotEdit: mergeUnique(fromSystemPages.doNotEditTargets, doNotEditTargets(classifications)),
    requiredSearches: requiredSearches(classifications),
    recommendedVerification: mergeUnique(fromSystemPages.recommendedVerification, recommendedVerification(classifications)),
    safetyIssues: collectSafetyIssues(input.nodes, input.edges, input.selected, targetText),
    overlays,
  };
};

interface SystemPageContributions {
  knownConstraints: string[];
  doNotEditTargets: string[];
  affectedChains: string[];
  recommendedVerification: string[];
}

const collectSystemPageContributions = (
  systemPageRules: ContextNode[],
  classifications: string[],
): SystemPageContributions => {
  const result: SystemPageContributions = {
    knownConstraints: [],
    doNotEditTargets: [],
    affectedChains: [],
    recommendedVerification: [],
  };
  if (systemPageRules.length === 0) return result;

  const wanted = new Set(classifications);
  for (const rule of systemPageRules) {
    const metadata = rule.metadata ?? {};
    const ruleClassifications = readStringArray(metadata['classifications']);
    // A rule with no `classifications` is a global page (e.g. validation
    // playbook) — apply its recommendedVerification universally but skip
    // its other fields so it doesn't drown out targeted guidance.
    const matches = ruleClassifications.length === 0
      || ruleClassifications.some((value) => wanted.has(value));
    if (!matches) continue;

    if (ruleClassifications.length > 0) {
      pushAll(result.knownConstraints, readStringArray(metadata['knownConstraints']));
      pushAll(result.doNotEditTargets, readStringArray(metadata['doNotEditTargets']));
      const chain = metadata['affectedChain'];
      if (typeof chain === 'string' && chain.length > 0) result.affectedChains.push(chain);
    }
    pushAll(result.recommendedVerification, readStringArray(metadata['recommendedVerification']));
  }
  return result;
};

const readStringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  : [];

const pushAll = (target: string[], values: string[]): void => {
  for (const value of values) target.push(value);
};

const mergeUnique = (primary: string[], fallback: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of [...primary, ...fallback]) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
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

export const selectTaskNodes = (
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

