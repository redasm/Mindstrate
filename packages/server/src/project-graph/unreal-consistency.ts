import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  isProjectGraphEdge,
  isProjectGraphNode,
  type ContextEdge,
  type ContextNode,
} from '@mindstrate/protocol/models';

export interface UnrealPluginDependencyConsistencyInput {
  nodes: ContextNode[];
  edges: ContextEdge[];
}

export interface UnrealModuleBoundaryConsistencyInput {
  nodes: ContextNode[];
  edges: ContextEdge[];
}

export interface UnrealPluginDependencyConsistencyIssue {
  code: 'missing-plugin-dependency';
  severity: 'error';
  plugin: string;
  pluginManifest: string;
  module: string;
  moduleFile: string;
  dependencyModule: string;
  requiredPlugin: string;
  message: string;
  evidence: string[];
}

export interface UnrealModuleBoundaryConsistencyIssue {
  code: 'runtime-depends-on-editor-module';
  severity: 'error';
  module: string;
  moduleType?: string;
  moduleFile?: string;
  dependencyModule: string;
  dependencyModuleType?: string;
  dependencyModuleFile?: string;
  message: string;
  evidence: string[];
}

export const checkUnrealPluginDependencyConsistency = (
  input: UnrealPluginDependencyConsistencyInput,
): UnrealPluginDependencyConsistencyIssue[] => {
  const nodes = input.nodes.filter(isProjectGraphNode);
  const edges = input.edges.filter(isProjectGraphEdge);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const modulesByName = new Map(nodes
    .filter((node) => kindOf(node) === ProjectGraphNodeKind.MODULE && node.metadata?.['unrealModule'] === true)
    .map((node) => [node.title, node]));
  const pluginDependencies = collectDeclaredPluginDependencies(nodesById, edges);
  const issues: UnrealPluginDependencyConsistencyIssue[] = [];

  for (const edge of edges) {
    if (edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] !== ProjectGraphEdgeKind.DEPENDS_ON) continue;
    if (edge.evidence?.['dependencyKind'] !== 'unreal-module') continue;
    const sourceModule = nodesById.get(edge.sourceId);
    const dependency = nodesById.get(edge.targetId);
    if (!sourceModule || !dependency || kindOf(sourceModule) !== ProjectGraphNodeKind.MODULE) continue;
    const sourceFile = stringMetadata(sourceModule, 'declaredIn');
    if (!sourceFile) continue;
    const sourcePlugin = pluginNameForPath(sourceFile);
    if (!sourcePlugin) continue;
    const targetModule = modulesByName.get(dependency.title);
    const targetFile = targetModule ? stringMetadata(targetModule, 'declaredIn') : undefined;
    const targetPlugin = targetFile ? pluginNameForPath(targetFile) : undefined;
    if (!targetPlugin || targetPlugin === sourcePlugin) continue;
    const declared = pluginDependencies.get(sourcePlugin);
    if (declared?.dependencies.has(targetPlugin)) continue;
    issues.push({
      code: 'missing-plugin-dependency',
      severity: 'error',
      plugin: sourcePlugin,
      pluginManifest: declared?.manifest ?? `Plugins/${sourcePlugin}/${sourcePlugin}.uplugin`,
      module: sourceModule.title,
      moduleFile: sourceFile,
      dependencyModule: dependency.title,
      requiredPlugin: targetPlugin,
      message: `${sourcePlugin} module ${sourceModule.title} depends on ${dependency.title}, but ${sourcePlugin}.uplugin does not declare plugin dependency ${targetPlugin}.`,
      evidence: evidencePaths([sourceModule, dependency, targetModule].filter((node): node is ContextNode => !!node)),
    });
  }

  return issues;
};

export const checkUnrealModuleBoundaryConsistency = (
  input: UnrealModuleBoundaryConsistencyInput,
): UnrealModuleBoundaryConsistencyIssue[] => {
  const nodes = input.nodes.filter(isProjectGraphNode);
  const edges = input.edges.filter(isProjectGraphEdge);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const modulesByName = new Map(nodes
    .filter((node) => kindOf(node) === ProjectGraphNodeKind.MODULE && node.metadata?.['unrealModule'] === true)
    .map((node) => [node.title, node]));
  const issues: UnrealModuleBoundaryConsistencyIssue[] = [];

  for (const edge of edges) {
    if (edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] !== ProjectGraphEdgeKind.DEPENDS_ON) continue;
    if (edge.evidence?.['dependencyKind'] !== 'unreal-module') continue;
    const sourceModule = nodesById.get(edge.sourceId);
    const dependency = nodesById.get(edge.targetId);
    if (!sourceModule || !dependency || kindOf(sourceModule) !== ProjectGraphNodeKind.MODULE) continue;
    const targetModule = modulesByName.get(dependency.title);
    if (!targetModule) continue;
    const sourceType = stringMetadata(sourceModule, 'moduleType');
    const targetType = stringMetadata(targetModule, 'moduleType');
    if (isEditorOnlyModuleType(sourceType) || !isEditorOnlyModuleType(targetType)) continue;
    const sourceFile = stringMetadata(sourceModule, 'declaredIn');
    const targetFile = stringMetadata(targetModule, 'declaredIn');
    issues.push({
      code: 'runtime-depends-on-editor-module',
      severity: 'error',
      module: sourceModule.title,
      moduleType: sourceType,
      moduleFile: sourceFile,
      dependencyModule: targetModule.title,
      dependencyModuleType: targetType,
      dependencyModuleFile: targetFile,
      message: `${sourceModule.title} (${sourceType ?? 'unknown module type'}) depends on editor-only module ${targetModule.title}. Runtime modules must not depend on Editor modules.`,
      evidence: evidencePaths([sourceModule, dependency, targetModule]),
    });
  }

  return issues;
};

const collectDeclaredPluginDependencies = (
  nodesById: Map<string, ContextNode>,
  edges: ContextEdge[],
): Map<string, { manifest: string; dependencies: Set<string> }> => {
  const dependencies = new Map<string, { manifest: string; dependencies: Set<string> }>();
  for (const edge of edges) {
    if (edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] !== ProjectGraphEdgeKind.DEPENDS_ON) continue;
    if (edge.evidence?.['dependencyKind'] !== 'unreal-plugin') continue;
    const source = nodesById.get(edge.sourceId);
    const target = nodesById.get(edge.targetId);
    if (!source || !target) continue;
    const manifest = source.title;
    const plugin = pluginNameForPath(manifest);
    if (!plugin) continue;
    const entry = dependencies.get(plugin) ?? { manifest, dependencies: new Set<string>() };
    entry.dependencies.add(target.title);
    dependencies.set(plugin, entry);
  }
  return dependencies;
};

const kindOf = (node: ContextNode): string | undefined =>
  typeof node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === 'string'
    ? String(node.metadata[PROJECT_GRAPH_METADATA_KEYS.kind])
    : undefined;

const stringMetadata = (node: ContextNode, key: string): string | undefined =>
  typeof node.metadata?.[key] === 'string' ? String(node.metadata[key]) : undefined;

const isEditorOnlyModuleType = (moduleType: string | undefined): boolean =>
  typeof moduleType === 'string' && moduleType.toLowerCase().includes('editor');

const pluginNameForPath = (filePath: string): string | undefined =>
  normalizePath(filePath).match(/^Plugins\/([^/]+)\//)?.[1];

const evidencePaths = (nodes: ContextNode[]): string[] =>
  Array.from(new Set(nodes.flatMap((node) => {
    const evidence = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence];
    return Array.isArray(evidence)
      ? evidence.map((entry) => typeof entry?.path === 'string' ? entry.path : undefined).filter((value): value is string => !!value)
      : [];
  })));

const normalizePath = (value: string): string => value.replace(/\\/g, '/');
