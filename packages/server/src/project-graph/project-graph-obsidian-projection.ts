import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  ProjectGraphEdgeKind,
  ProjectionTarget,
  type ProjectGraphArtifact,
  type ProjectGraphArtifactEdge,
  type ProjectGraphArtifactNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';
import { collectProjectGraphModules } from './clustering.js';
import { listProjectGraphOverlays } from './overlay.js';
import { projectGraphOverlayProjectionForNode } from './overlay-application.js';
import { collectProjectGraphArtifact } from './project-graph-artifact-collector.js';
import { writeProjectGraphTextFileAtomically } from './project-graph-file-io.js';
import { importProjectGraphOverlayBlock } from './project-graph-overlay-import.js';
import { enSystemPageDefinitions } from './obsidian-system-pages-en.js';
import { zhSystemPageDefinitions } from './obsidian-system-pages-zh.js';
import type { SystemPageDefinition } from './obsidian-system-page-types.js';
export type { SystemPageDefinition } from './obsidian-system-page-types.js';
import {
  renderEditableModulePage,
  renderEditableObsidianProjection,
  renderProjectGraphReport,
} from './project-graph-report-renderer.js';
import { preserveProjectGraphBlock, slugifyProjectGraphValue } from './project-graph-report-shared.js';
import type { ProjectGraphArtifactResult } from './project-graph-report-types.js';
import { collectProjectGraphStats } from './project-graph-stats.js';
import { resolveProjectGraphLocale } from './project-graph-locale.js';

export const writeProjectGraphObsidianProjection = (
  store: ContextGraphStore,
  project: DetectedProject,
  vaultRoot: string,
  options: ProjectGraphObsidianProjectionOptions = {},
): ProjectGraphArtifactResult => {
  const projectSlug = slugifyProjectGraphValue(project.name);
  const reportPath = path.join(vaultRoot, projectSlug, 'architecture', 'project-graph.md');
  const statsPath = path.join(project.root, '.mindstrate', 'project-graph.json');
  const graphPath = path.join(project.root, '.mindstrate', 'project-graph.graph.json');
  const existing = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  importProjectGraphOverlayBlock(store, project.name, existing);
  importExistingSystemPageOverlays(
    store,
    project.name,
    vaultRoot,
    projectSlug,
    options.systemPages?.map((page) => page.name),
  );
  importExistingSummaryPageOverlays(store, project.name, vaultRoot, projectSlug);
  const stats = collectProjectGraphStats(store, project);
  const generated = renderProjectGraphReport(project, stats);
  const overlays = listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
  const report = renderEditableObsidianProjection(generated, existing, overlays);
  const graph = collectProjectGraphArtifact(store, project, stats);
  const modulePaths = writeObsidianModulePages(store, project, vaultRoot, projectSlug);
  const nodePaths = writeObsidianNodePages(graph, vaultRoot, projectSlug, overlays);
  const flowAndBindingPaths = writeObsidianFlowAndBindingPages(graph, vaultRoot, projectSlug);
  const systemPages = writeObsidianSystemPages(project, vaultRoot, projectSlug, options.systemPages);

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  writeProjectGraphTextFileAtomically(reportPath, report);
  writeProjectGraphTextFileAtomically(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
  writeProjectGraphTextFileAtomically(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  writeObsidianProjectionIndex(vaultRoot, projectSlug, [
    { key: 'project-graph', path: reportPath, role: 'project-graph', priority: 100 },
    ...systemPages.map((page, index) => ({ key: `system:${page.key}`, path: page.path, role: 'system', priority: 95 - index })),
    ...flowAndBindingPaths.map((filePath) => ({
      key: `relationship:${path.basename(filePath, '.md')}`,
      path: filePath,
      role: filePath.endsWith('.generated.md') ? 'generated-detail' : 'summary',
      priority: filePath.endsWith('.generated.md') ? 40 : 80,
    })),
    { key: 'nodes:index', path: nodePaths[0], role: 'node-index', priority: 50 },
  ]);
  if (stats.projectionNodeId) {
    store.upsertProjectionRecord({
      id: `projection:${ProjectionTarget.PROJECT_GRAPH_OBSIDIAN}:${project.name}`,
      nodeId: stats.projectionNodeId,
      target: ProjectionTarget.PROJECT_GRAPH_OBSIDIAN,
      targetRef: reportPath,
      version: 1,
      projectedAt: stats.generatedAt,
    });
  }

  return {
    reportPath,
    statsPath,
    graphPath,
    modulePaths,
    nodePaths,
    nodes: stats.nodes,
    edges: stats.edges,
  };
};

export interface ProjectGraphObsidianProjectionOptions {
  systemPages?: SystemPageDefinition[];
}

const SYSTEM_PAGE_NAMES = [
  '00-overview.md',
  '01-runtime-lifecycle.md',
  '02-cpp-typescript-bridge.md',
  '03-plugin-boundaries.md',
  '04-generated-files.md',
  '05-validation-playbook.md',
  '06-common-change-playbooks.md',
  '07-risky-files.md',
  '00-总览.md',
  '01-运行时生命周期.md',
  '02-cpp-typescript-桥接.md',
  '03-插件边界.md',
  '04-生成文件.md',
  '05-验证手册.md',
  '06-常见变更手册.md',
  '07-高风险文件.md',
];

const importExistingSystemPageOverlays = (
  store: ContextGraphStore,
  projectName: string,
  vaultRoot: string,
  projectSlug: string,
  plannedPageNames: string[] = [],
): void => {
  const architectureDir = path.join(vaultRoot, projectSlug, 'architecture');
  for (const pageName of new Set([...SYSTEM_PAGE_NAMES, ...plannedPageNames])) {
    const pagePath = path.join(architectureDir, pageName);
    if (fs.existsSync(pagePath)) importProjectGraphOverlayBlock(store, projectName, fs.readFileSync(pagePath, 'utf8'));
  }
};

const importExistingSummaryPageOverlays = (
  store: ContextGraphStore,
  projectName: string,
  vaultRoot: string,
  projectSlug: string,
): void => {
  for (const pagePath of [
    path.join(vaultRoot, projectSlug, 'architecture', 'flows', 'execution-flow.md'),
    path.join(vaultRoot, projectSlug, 'architecture', 'bindings', 'native-script.md'),
  ]) {
    if (fs.existsSync(pagePath)) importProjectGraphOverlayBlock(store, projectName, fs.readFileSync(pagePath, 'utf8'));
  }
};

const writeObsidianSystemPages = (
  project: DetectedProject,
  vaultRoot: string,
  projectSlug: string,
  plannedPages?: SystemPageDefinition[],
): Array<{ key: string; path: string }> => {
  const architectureDir = path.join(vaultRoot, projectSlug, 'architecture');
  const pages: Array<{ key: string; path: string }> = [];
  for (const page of plannedPages && plannedPages.length > 0 ? plannedPages : systemPageDefinitions(project)) {
    const pagePath = path.join(architectureDir, page.name);
    const existing = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';
    writeProjectGraphTextFileAtomically(pagePath, renderSystemPage(page, existing));
    pages.push({ key: page.key, path: pagePath });
  }
  return pages;
};

interface ObsidianProjectionIndexEntry {
  key: string;
  path: string | undefined;
  role: string;
  priority: number;
}

const writeObsidianProjectionIndex = (
  vaultRoot: string,
  projectSlug: string,
  entries: ObsidianProjectionIndexEntry[],
): void => {
  const metaDir = path.join(vaultRoot, '_meta');
  const indexPath = path.join(metaDir, 'index.json');
  fs.mkdirSync(metaDir, { recursive: true });
  const current = readObsidianIndex(indexPath);
  const currentPages = current['projectGraphPages'] && typeof current['projectGraphPages'] === 'object'
    ? current['projectGraphPages'] as Record<string, unknown>
    : {};
  const nextPages = Object.fromEntries(Object.entries(currentPages)
    .filter(([, value]) => !isProjectGraphPageForProject(value, projectSlug)));
  for (const entry of entries) {
    if (!entry.path) continue;
    nextPages[`${projectSlug}:${entry.key}`] = {
      project: projectSlug,
      path: relativePath(vaultRoot, entry.path),
      role: entry.role,
      priority: entry.priority,
    };
  }
  writeProjectGraphTextFileAtomically(indexPath, `${JSON.stringify({
    ...current,
    version: typeof current['version'] === 'number' ? current['version'] : 1,
    files: current['files'] && typeof current['files'] === 'object' ? current['files'] : {},
    projectGraphPages: nextPages,
  }, null, 2)}\n`);
};

const readObsidianIndex = (indexPath: string): Record<string, unknown> => {
  if (!fs.existsSync(indexPath)) return { files: {}, version: 1 };
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : { files: {}, version: 1 };
  } catch {
    return { files: {}, version: 1 };
  }
};

const isProjectGraphPageForProject = (value: unknown, projectSlug: string): boolean =>
  !!value && typeof value === 'object' && (value as Record<string, unknown>)['project'] === projectSlug;

const relativePath = (root: string, filePath: string): string =>
  path.relative(root, filePath).split(path.sep).join('/');

const systemPageDefinitions = (project: DetectedProject): SystemPageDefinition[] => {
  const locale = resolveProjectGraphLocale();
  const generatedRoots = project.graphHints?.generatedRoots ?? ['Binaries', 'Intermediate', 'Saved', 'DerivedDataCache', 'TypeScript/Typing'];
  if (locale === 'zh') return zhSystemPageDefinitions(project, generatedRoots);
  return enSystemPageDefinitions(project, generatedRoots);
};


const renderSystemPage = (page: SystemPageDefinition, existing: string): string => [
  '<!-- mindstrate:project-graph:system-generated:start -->',
  `# ${page.title}`,
  '',
  ...page.body,
  '<!-- mindstrate:project-graph:system-generated:end -->',
  '',
  `## ${page.userNotesTitle}`,
  '',
  '<!-- mindstrate:project-graph:user-notes:start -->',
  preserveProjectGraphBlock(existing, 'user-notes') || page.userNotesPlaceholder,
  '<!-- mindstrate:project-graph:user-notes:end -->',
  '',
  `## ${page.overlayTitle}`,
  '',
  '<!-- mindstrate:project-graph:overlay:start -->',
  preserveProjectGraphBlock(existing, 'overlay') || page.overlays.join('\n'),
  '<!-- mindstrate:project-graph:overlay:end -->',
  '',
].join('\n');

const writeObsidianFlowAndBindingPages = (
  graph: ProjectGraphArtifact,
  vaultRoot: string,
  projectSlug: string,
): string[] => {
  const architectureDir = path.join(vaultRoot, projectSlug, 'architecture');
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const flowEdges = graph.edges.filter((edge) => [
    ProjectGraphEdgeKind.ENTRYPOINT_TO,
    ProjectGraphEdgeKind.CALLS,
    ProjectGraphEdgeKind.BINDS_TO,
    ProjectGraphEdgeKind.ROUTES_TO,
  ].includes(edge.kind as ProjectGraphEdgeKind));
  const bindingEdges = graph.edges.filter((edge) => edge.kind === ProjectGraphEdgeKind.BINDS_TO);
  const flowSummaryPath = path.join(architectureDir, 'flows', 'execution-flow.md');
  const bindingSummaryPath = path.join(architectureDir, 'bindings', 'native-script.md');

  writeProjectGraphTextFileAtomically(
    flowSummaryPath,
    renderEdgeSummaryPage({
      title: 'Execution Flow',
      generatedPage: 'execution-flow.generated.md',
      edgeCount: flowEdges.length,
      existing: fs.existsSync(flowSummaryPath) ? fs.readFileSync(flowSummaryPath, 'utf8') : '',
      body: [
        '## Purpose',
        '',
        '- Human-readable summary page for entrypoint, call, route, and binding relationships.',
        '- Use the generated detail page only after checking the lifecycle and boundary pages.',
        '',
        '## Before Editing',
        '',
        '- Query `before-edit` and `impact` for the target subsystem or file.',
        '- Check module ownership before following raw call edges.',
      ],
      overlays: [
        '- kind: convention',
        '  content: Treat raw execution-flow edges as navigation hints, not as confirmed lifecycle documentation.',
      ],
    }),
  );
  const flowGeneratedPath = path.join(architectureDir, 'flows', 'execution-flow.generated.md');
  writeProjectGraphTextFileAtomically(
    flowGeneratedPath,
    renderEdgeProjectionPage('Execution Flow Details', flowEdges, nodeById),
  );
  writeProjectGraphTextFileAtomically(
    bindingSummaryPath,
    renderEdgeSummaryPage({
      title: 'Native Script Bindings',
      generatedPage: 'native-script.generated.md',
      edgeCount: bindingEdges.length,
      existing: fs.existsSync(bindingSummaryPath) ? fs.readFileSync(bindingSummaryPath, 'utf8') : '',
      body: [
        '## Purpose',
        '',
        '- Human-readable summary page for native C++ APIs exposed to the script/TypeScript layer.',
        '- Keep source-of-truth decisions here and leave raw binding facts in the generated detail page.',
        '',
        '## Source Of Truth',
        '',
        '- C++ reflection source and UnrealSharp generator/configuration.',
        '- `TypeScript/Typing` is generated output and should not be edited manually.',
        '',
        '## Verify',
        '',
        '- Build affected C++ target, run type generation, inspect generated declarations, and run TS validation.',
      ],
      overlays: [
        '- kind: convention',
        '  target: TypeScript/Typing',
        '  content: Native script binding fixes must update C++ reflection source or generator configuration before generated TypeScript declarations.',
      ],
    }),
  );
  const bindingGeneratedPath = path.join(architectureDir, 'bindings', 'native-script.generated.md');
  writeProjectGraphTextFileAtomically(
    bindingGeneratedPath,
    renderEdgeProjectionPage('Native Script Binding Details', bindingEdges, nodeById),
  );
  return [flowSummaryPath, flowGeneratedPath, bindingSummaryPath, bindingGeneratedPath];
};

const renderEdgeSummaryPage = (input: {
  title: string;
  generatedPage: string;
  edgeCount: number;
  existing: string;
  body: string[];
  overlays: string[];
}): string => [
  '<!-- mindstrate:project-graph:summary-generated:start -->',
  `# ${input.title}`,
  '',
  `- Generated detail page: [[${input.generatedPage}]]`,
  `- Extracted edge count: ${input.edgeCount}`,
  '',
  ...input.body,
  '<!-- mindstrate:project-graph:summary-generated:end -->',
  '',
  '## User Notes',
  '',
  '<!-- mindstrate:project-graph:user-notes:start -->',
  preserveProjectGraphBlock(input.existing, 'user-notes') || '- Add project-specific binding or flow notes here.',
  '<!-- mindstrate:project-graph:user-notes:end -->',
  '',
  '## Structured Overlay',
  '',
  '<!-- mindstrate:project-graph:overlay:start -->',
  preserveProjectGraphBlock(input.existing, 'overlay') || input.overlays.join('\n'),
  '<!-- mindstrate:project-graph:overlay:end -->',
  '',
].join('\n');

const renderEdgeProjectionPage = (
  title: string,
  edges: ProjectGraphArtifactEdge[],
  nodeById: Map<string, ProjectGraphArtifactNode>,
): string => [
  `# ${title}`,
  '',
  '<!-- mindstrate:project-graph:generated:start -->',
  ...(edges.length > 0
    ? edges
      .slice()
      .sort((left, right) => `${left.kind}:${left.sourceId}:${left.targetId}`.localeCompare(`${right.kind}:${right.sourceId}:${right.targetId}`))
      .map((edge) => {
        const source = nodeById.get(edge.sourceId);
        const target = nodeById.get(edge.targetId);
        const evidence = edge.evidence[0]?.path ? ` (${formatEvidence(edge.evidence[0].path, edge.evidence[0].startLine, edge.evidence[0].endLine)})` : '';
        return `- ${nodeLink(source, edge.sourceId)} ${edge.kind} ${nodeLink(target, edge.targetId)}${evidence}`;
      })
    : ['- None detected yet.']),
  '<!-- mindstrate:project-graph:generated:end -->',
  '',
].join('\n');

const writeObsidianModulePages = (
  store: ContextGraphStore,
  project: DetectedProject,
  vaultRoot: string,
  projectSlug: string,
): string[] => {
  const modules = collectProjectGraphModules(store, project.name);
  return modules.map((module) => {
    const modulePath = path.join(
      vaultRoot,
      projectSlug,
      'architecture',
      'modules',
      `${slugifyProjectGraphValue(module.label)}.md`,
    );
    const existing = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';
    const overlays = listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
    writeProjectGraphTextFileAtomically(modulePath, renderEditableModulePage(module, overlays, existing));
    return modulePath;
  });
};

const writeObsidianNodePages = (
  graph: ProjectGraphArtifact,
  vaultRoot: string,
  projectSlug: string,
  overlays: ReturnType<typeof listProjectGraphOverlays>,
): string[] => {
  const nodeDir = path.join(vaultRoot, projectSlug, 'architecture', 'nodes');
  fs.mkdirSync(nodeDir, { recursive: true });
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = edgesBy(graph.edges, (edge) => edge.sourceId);
  const incoming = edgesBy(graph.edges, (edge) => edge.targetId);
  const written = new Set<string>();
  const paths: string[] = [];

  for (const node of graph.nodes) {
    const nodePath = path.join(nodeDir, `${nodePageSlug(node)}.md`);
    writeProjectGraphTextFileAtomically(nodePath, renderObsidianNodePage({
      node,
      outgoing: outgoing.get(node.id) ?? [],
      incoming: incoming.get(node.id) ?? [],
      nodeById,
      overlays,
    }));
    written.add(path.basename(nodePath));
    paths.push(nodePath);
  }

  const indexPath = path.join(nodeDir, 'index.md');
  writeProjectGraphTextFileAtomically(indexPath, renderObsidianNodeIndex(graph.nodes, overlays));
  written.add('index.md');
  paths.unshift(indexPath);

  for (const entry of fs.readdirSync(nodeDir)) {
    if (entry.endsWith('.md') && !written.has(entry)) fs.rmSync(path.join(nodeDir, entry));
  }

  return paths;
};

const renderObsidianNodeIndex = (nodes: ProjectGraphArtifactNode[], overlays: ReturnType<typeof listProjectGraphOverlays>): string => {
  const zh = resolveProjectGraphLocale() === 'zh';
  return [
    `# ${zh ? '图节点索引' : 'Graph Node Index'}`,
    '',
    ...nodes
      .slice()
      .sort((left, right) => `${left.kind}:${left.label}`.localeCompare(`${right.kind}:${right.label}`))
      .map((node) => `- [[nodes/${nodePageSlug(node)}|${escapeWikiLabel(projectGraphOverlayProjectionForNode(node, overlays).displayLabel)}]] (${node.kind})`),
    '',
  ].join('\n');
};

const renderObsidianNodePage = (input: {
  node: ProjectGraphArtifactNode;
  outgoing: ProjectGraphArtifactEdge[];
  incoming: ProjectGraphArtifactEdge[];
  nodeById: Map<string, ProjectGraphArtifactNode>;
  overlays: ReturnType<typeof listProjectGraphOverlays>;
}): string => {
  const zh = resolveProjectGraphLocale() === 'zh';
  const overlayProjection = projectGraphOverlayProjectionForNode(input.node, input.overlays);
  return [
    `# ${overlayProjection.displayLabel}`,
    '',
    ...(overlayProjection.displayLabel !== input.node.label ? [`- ${zh ? '原始标签' : 'Raw label'}: ${input.node.label}`] : []),
    `- ${zh ? '类型' : 'Kind'}: ${input.node.kind}`,
    `- ${zh ? '来源' : 'Provenance'}: ${input.node.provenance}`,
    `- ${zh ? '置信度' : 'Confidence'}: ${input.node.confidence}`,
    `- ${zh ? '项目' : 'Project'}: ${input.node.project}`,
    ...(overlayProjection.correction ? [`- ${zh ? '用户修正' : 'User correction'}: ${overlayProjection.correction}`] : []),
    '',
    `## ${zh ? '出向关系' : 'Outgoing Relations'}`,
    '',
    ...edgeLines(input.outgoing, input.nodeById, 'targetId', zh),
    '',
    `## ${zh ? '入向关系' : 'Incoming Relations'}`,
    '',
    ...edgeLines(input.incoming, input.nodeById, 'sourceId', zh),
    '',
    `## ${zh ? '证据' : 'Evidence'}`,
    '',
    ...(input.node.evidence.length > 0
      ? input.node.evidence.map((entry) => `- ${formatEvidence(entry.path, entry.startLine, entry.endLine)}`)
      : [zh ? '- 暂无证据。' : '- No evidence.']),
    '',
  ].join('\n');
};

const edgeLines = (
  edges: ProjectGraphArtifactEdge[],
  nodeById: Map<string, ProjectGraphArtifactNode>,
  linkedNodeKey: 'sourceId' | 'targetId',
  zh: boolean,
): string[] => {
  if (edges.length === 0) return [zh ? '- 暂无。' : '- None.'];
  return edges
    .slice()
    .sort((left, right) => `${left.kind}:${left[linkedNodeKey]}`.localeCompare(`${right.kind}:${right[linkedNodeKey]}`))
    .map((edge) => {
      const node = nodeById.get(edge[linkedNodeKey]);
      const target = node
        ? `[[nodes/${nodePageSlug(node)}|${escapeWikiLabel(node.label)}]]`
        : edge[linkedNodeKey];
      const evidence = edge.evidence[0]?.path ? ` (${formatEvidence(edge.evidence[0].path, edge.evidence[0].startLine, edge.evidence[0].endLine)})` : '';
      return `- ${edge.kind}: ${target}${evidence}`;
    });
};

const edgesBy = (
  edges: ProjectGraphArtifactEdge[],
  keyFor: (edge: ProjectGraphArtifactEdge) => string,
): Map<string, ProjectGraphArtifactEdge[]> => {
  const result = new Map<string, ProjectGraphArtifactEdge[]>();
  for (const edge of edges) {
    const key = keyFor(edge);
    const current = result.get(key) ?? [];
    current.push(edge);
    result.set(key, current);
  }
  return result;
};

const nodePageSlug = (node: ProjectGraphArtifactNode): string => {
  const slug = slugifyProjectGraphValue(`${node.kind}-${node.label}`);
  const hash = createHash('sha1').update(node.id).digest('hex').slice(0, 8);
  return `${slug}-${hash}`;
};

const escapeWikiLabel = (value: string): string => value.replace(/[\[\]|]/g, ' ').replace(/\s+/g, ' ').trim();

const nodeLink = (node: ProjectGraphArtifactNode | undefined, fallback: string): string =>
  node ? `[[nodes/${nodePageSlug(node)}|${escapeWikiLabel(node.label)}]]` : fallback;

const formatEvidence = (filePath: string, startLine?: number, endLine?: number): string => {
  if (typeof startLine !== 'number') return filePath;
  if (typeof endLine === 'number' && endLine !== startLine) return `${filePath}:${startLine}-${endLine}`;
  return `${filePath}:${startLine}`;
};
