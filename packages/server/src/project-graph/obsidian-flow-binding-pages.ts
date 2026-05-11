/**
 * Obsidian flow / native-binding summary + generated detail page writers.
 *
 * Two paired pages live under `architecture/flows` and `architecture/bindings`:
 *  - A human-edited summary page (with preserved user-notes / overlay blocks)
 *  - A generated detail page rebuilt from the canonical project graph edges
 *
 * Overlays from the existing summary pages are re-imported so any
 * user-authored overlay block survives the next projection write.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ProjectGraphEdgeKind,
  type ProjectGraphArtifact,
  type ProjectGraphArtifactEdge,
  type ProjectGraphArtifactNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { writeProjectGraphTextFileAtomically } from './project-graph-file-io.js';
import { importProjectGraphOverlayBlock } from './project-graph-overlay-import.js';
import { preserveProjectGraphBlock } from './project-graph-report-shared.js';
import { formatEvidenceLocation, nodeWikiLink } from './obsidian-rendering-shared.js';
import { nodePageSlug } from './obsidian-node-pages.js';

export const importExistingSummaryPageOverlays = (
  store: ContextGraphStore,
  projectName: string,
  vaultRoot: string,
  projectSlug: string,
): void => {
  for (const pagePath of [
    path.join(vaultRoot, projectSlug, 'architecture', 'flows', 'execution-flow.md'),
    path.join(vaultRoot, projectSlug, 'architecture', 'bindings', 'native-script.md'),
  ]) {
    if (fs.existsSync(pagePath)) {
      importProjectGraphOverlayBlock(store, projectName, fs.readFileSync(pagePath, 'utf8'));
    }
  }
};

export const writeObsidianFlowAndBindingPages = (
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
        const evidence = edge.evidence[0]?.path
          ? ` (${formatEvidenceLocation(edge.evidence[0].path, edge.evidence[0].startLine, edge.evidence[0].endLine)})`
          : '';
        return `- ${nodeLink(source, edge.sourceId)} ${edge.kind} ${nodeLink(target, edge.targetId)}${evidence}`;
      })
    : ['- None detected yet.']),
  '<!-- mindstrate:project-graph:generated:end -->',
  '',
].join('\n');

const nodeLink = (node: ProjectGraphArtifactNode | undefined, fallback: string): string =>
  node ? nodeWikiLink(node.label, nodePageSlug(node)) : fallback;
