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
import { collectProjectGraphArtifact } from './project-graph-artifact.js';
import { writeProjectGraphTextFileAtomically } from './project-graph-file-io.js';
import { importProjectGraphOverlayBlock } from './project-graph-overlay-import.js';
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
): ProjectGraphArtifactResult => {
  const projectSlug = slugifyProjectGraphValue(project.name);
  const reportPath = path.join(vaultRoot, projectSlug, 'architecture', 'project-graph.md');
  const statsPath = path.join(project.root, '.mindstrate', 'project-graph.json');
  const graphPath = path.join(project.root, '.mindstrate', 'project-graph.graph.json');
  const existing = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  importProjectGraphOverlayBlock(store, project.name, existing);
  importExistingSystemPageOverlays(store, project.name, vaultRoot, projectSlug);
  importExistingSummaryPageOverlays(store, project.name, vaultRoot, projectSlug);
  const stats = collectProjectGraphStats(store, project);
  const generated = renderProjectGraphReport(project, stats);
  const overlays = listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
  const report = renderEditableObsidianProjection(generated, existing, overlays);
  const graph = collectProjectGraphArtifact(store, project, stats);
  const modulePaths = writeObsidianModulePages(store, project, vaultRoot, projectSlug);
  const nodePaths = writeObsidianNodePages(graph, vaultRoot, projectSlug, overlays);
  writeObsidianFlowAndBindingPages(graph, vaultRoot, projectSlug);
  writeObsidianSystemPages(project, vaultRoot, projectSlug);

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  writeProjectGraphTextFileAtomically(reportPath, report);
  writeProjectGraphTextFileAtomically(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
  writeProjectGraphTextFileAtomically(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
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

const SYSTEM_PAGE_NAMES = [
  '00-overview.md',
  '01-runtime-lifecycle.md',
  '02-cpp-typescript-bridge.md',
  '03-plugin-boundaries.md',
  '04-generated-files.md',
  '05-validation-playbook.md',
  '06-common-change-playbooks.md',
  '07-risky-files.md',
];

const importExistingSystemPageOverlays = (
  store: ContextGraphStore,
  projectName: string,
  vaultRoot: string,
  projectSlug: string,
): void => {
  const architectureDir = path.join(vaultRoot, projectSlug, 'architecture');
  for (const pageName of SYSTEM_PAGE_NAMES) {
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
): void => {
  const architectureDir = path.join(vaultRoot, projectSlug, 'architecture');
  for (const page of systemPageDefinitions(project)) {
    const pagePath = path.join(architectureDir, page.name);
    const existing = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';
    writeProjectGraphTextFileAtomically(pagePath, renderSystemPage(page, existing));
  }
};

interface SystemPageDefinition {
  name: string;
  title: string;
  body: string[];
  overlays: string[];
}

const systemPageDefinitions = (project: DetectedProject): SystemPageDefinition[] => {
  const generatedRoots = project.graphHints?.generatedRoots ?? ['Binaries', 'Intermediate', 'Saved', 'DerivedDataCache', 'TypeScript/Typing'];
  const validationIntro = 'Replace placeholder commands with the project-approved command once confirmed by a human maintainer.';
  return [
    {
      name: '00-overview.md',
      title: `${project.name} Architecture Overview`,
      body: [
        '## Purpose',
        '',
        '- High-value human entry point for the project architecture. Use this before browsing raw graph nodes.',
        `- Framework: ${project.framework ?? 'unknown'}.`,
        `- Primary language: ${project.language ?? 'unknown'}.`,
        '',
        '## Primary Areas',
        '',
        '- Source: C++ runtime or application modules.',
        '- Plugins: project plugins, third-party extensions, editor tools, and runtime subsystems.',
        '- Config: engine, plugin, and game configuration.',
        '- Content: Unreal assets whose paths may be reference-sensitive.',
        '',
        '## Editing Rule',
        '',
        '- For non-trivial changes, query `before-edit` and `impact` before editing exact files.',
      ],
      overlays: [
        '- kind: convention',
        '  content: Use system architecture pages before raw graph node pages when planning non-trivial edits.',
      ],
    },
    {
      name: '01-runtime-lifecycle.md',
      title: 'Runtime Lifecycle',
      body: [
        '## Flow',
        '',
        '- `.uproject` defines enabled plugins and project-level module visibility.',
        '- `.uplugin` files define plugin modules, module type, loading phase, and plugin dependencies.',
        '- `*.Build.cs` files define module-level public and private dependencies.',
        '- Runtime startup loads compatible runtime modules; editor startup can also load editor-only modules.',
        '',
        '## Before Editing',
        '',
        '- If changing `.uproject`, `.uplugin`, or `*.Build.cs`, inspect module dependency direction and runtime/editor boundaries.',
      ],
      overlays: [
        '- kind: risk',
        '  target: .uproject',
        '  content: Project manifest changes can alter enabled plugins and startup behavior; query impact before editing.',
      ],
    },
    {
      name: '02-cpp-typescript-bridge.md',
      title: 'C++ To TypeScript Bridge',
      body: [
        '## Change Flow',
        '',
        '- C++ UCLASS/USTRUCT/UENUM/UFUNCTION/UPROPERTY declarations are the reflected source.',
        '- UnrealHeaderTool produces reflection metadata.',
        '- UnrealSharp generator consumes reflection metadata and configuration.',
        '- `TypeScript/Typing` receives generated declarations.',
        '- TypeScript business code consumes generated declarations.',
        '',
        '## Source Of Truth',
        '',
        '- C++ reflection source and UnrealSharp generator/configuration.',
        '- Generated TypeScript declarations are outputs, not source.',
      ],
      overlays: [
        '- kind: convention',
        '  target: TypeScript/Typing',
        '  content: TypeScript/Typing is generated output. Do not edit it manually; edit C++ reflection source or UnrealSharp generator/configuration instead.',
      ],
    },
    {
      name: '03-plugin-boundaries.md',
      title: 'Plugin And Module Boundaries',
      body: [
        '## Critical Boundaries',
        '',
        '- Runtime modules must not depend on editor-only modules.',
        '- Editor modules may depend on runtime modules when the editor tool extends runtime data.',
        '- `.uplugin` plugin dependencies and `*.Build.cs` module dependencies must remain consistent.',
        '- Public dependencies become part of the consuming module surface; private dependencies should stay implementation-only.',
      ],
      overlays: [
        '- kind: risk',
        '  target: *.Build.cs',
        '  content: Build.cs dependency changes can break Runtime/Editor boundaries. Check public/private dependency direction and .uplugin plugin dependencies before editing.',
        '- kind: risk',
        '  target: *.uplugin',
        '  content: Plugin module type, loading phase, and dependency changes are high-impact; validate editor/runtime startup after changing them.',
      ],
    },
    {
      name: '04-generated-files.md',
      title: 'Generated Files And Source Of Truth',
      body: [
        '## Generated Roots',
        '',
        ...generatedRoots.map((root) => `- ${root}`),
        '',
        '## Rule',
        '',
        '- If a target is under a generated root, stop and identify the upstream source of truth before editing.',
        '- Generated declaration drift should be fixed by changing source metadata or generator behavior.',
      ],
      overlays: [
        '- kind: convention',
        '  target: generated-roots',
        '  content: Binaries, Intermediate, Saved, DerivedDataCache, and TypeScript/Typing are generated or local output areas and should not be edited manually.',
      ],
    },
    {
      name: '05-validation-playbook.md',
      title: 'Validation Playbook',
      body: [
        '## Validation Policy',
        '',
        `- ${validationIntro}`,
        '- C++ source or Build.cs changes: run Unreal build compile for the affected target.',
        '- C++ reflection or binding changes: run Unreal build, type generation, generated declaration inspection, and TS type validation.',
        '- `.uproject` or `.uplugin` changes: validate plugin dependency consistency and editor/runtime startup.',
        '- Config changes: validate config load and the subsystem that reads it.',
        '- Content path changes: validate asset references with Unreal-aware tooling.',
      ],
      overlays: [
        '- kind: convention',
        '  content: Validation commands must be selected from the affected chain, not from the edited file extension alone.',
      ],
    },
    {
      name: '06-common-change-playbooks.md',
      title: 'Common Change Playbooks',
      body: [
        '## C++ Reflected API For TypeScript',
        '',
        '- Before edit: query graph impact, check generated declaration, search TS consumers, inspect owning Build.cs.',
        '- Edit: change C++ source/header or generator configuration; do not hand-edit TypeScript/Typing.',
        '- Verify: build C++, run generator, inspect declaration, run TS validation.',
        '',
        '## Plugin Or Build Dependency',
        '',
        '- Before edit: inspect `.uproject`, `.uplugin`, `*.Build.cs`, module type, loading phase, and runtime/editor boundary.',
        '- Verify: build affected target and validate editor/runtime startup.',
      ],
      overlays: [
        '- kind: convention',
        '  content: For known change types, follow the playbook before editing rather than relying on local file context only.',
      ],
    },
    {
      name: '07-risky-files.md',
      title: 'Risky Files',
      body: [
        '## High-Risk Targets',
        '',
        '- `.uproject`: enabled plugins and project-level startup behavior.',
        '- `.uplugin`: module type, loading phase, dependency declarations.',
        '- `*.Build.cs`: public/private module dependency graph.',
        '- `TypeScript/Typing`: generated declaration output.',
        '- `Content/**`: path-sensitive Unreal assets and references.',
        '- `Config/**`: startup and subsystem configuration.',
      ],
      overlays: [
        '- kind: risk',
        '  content: High-risk targets require impact analysis and source-of-truth identification before editing.',
      ],
    },
  ];
};

const renderSystemPage = (page: SystemPageDefinition, existing: string): string => [
  '<!-- mindstrate:project-graph:system-generated:start -->',
  `# ${page.title}`,
  '',
  ...page.body,
  '<!-- mindstrate:project-graph:system-generated:end -->',
  '',
  '## User Notes',
  '',
  '<!-- mindstrate:project-graph:user-notes:start -->',
  preserveProjectGraphBlock(existing, 'user-notes') || '- Add project-specific confirmations, corrections, or open questions here.',
  '<!-- mindstrate:project-graph:user-notes:end -->',
  '',
  '## Structured Overlay',
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
): void => {
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
  writeProjectGraphTextFileAtomically(
    path.join(architectureDir, 'flows', 'execution-flow.generated.md'),
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
  writeProjectGraphTextFileAtomically(
    path.join(architectureDir, 'bindings', 'native-script.generated.md'),
    renderEdgeProjectionPage('Native Script Binding Details', bindingEdges, nodeById),
  );
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
