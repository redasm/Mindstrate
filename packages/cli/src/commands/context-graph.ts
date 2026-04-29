/**
 * CLI Command: graph
 *
 * Focused project graph commands. These commands expose bounded graph context
 * for humans and MCP clients rather than dumping the entire ECS graph.
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ChangeSource,
  ContextDomainType,
  ProjectGraphOverlayKind,
  ProjectGraphOverlaySource,
  ProjectionTarget,
  type ContextEdge,
  type ContextNode,
  type ChangeSet,
  type ChangedFileStatus,
  type ProjectGraphOverlay,
  type ProjectionRecord,
} from '@mindstrate/server';
import {
  detectProject,
  detectProjectGraphChanges,
  errorMessage,
  estimateProjectGraphBlastRadius,
  findProjectGraphPath,
  listProjectGraphEvaluationFixtures,
  listProjectGraphEvaluationTasks,
  materializeProjectGraphEvaluationFixture,
  renderProjectGraphEvaluationDatasetMarkdown,
  truncateText as truncate,
} from '@mindstrate/server';
import { execSync } from 'node:child_process';
import { readProjectCliConfig, type ProjectCliConfig } from '../cli-config.js';
import { createMemory } from '../memory-factory.js';
import { publishProjectGraphToTeamServer, type ProjectGraphTeamClient } from './init.js';

export const contextGraphCommand = new Command('graph')
  .description('Query Mindstrate project graph');

contextGraphCommand
  .command('report')
  .description('Regenerate PROJECT_GRAPH.md and .mindstrate/project-graph.json')
  .option('-C, --cwd <path>', 'Run as if invoked in this directory')
  .action(async (options) => {
    const memory = createMemory();
    try {
      await memory.init();
      const project = detectProject(options.cwd ?? process.cwd());
      if (!project) throw new Error('Could not detect project.');
      const result = memory.context.writeProjectGraphArtifacts(project);
      console.log(`Report: ${result.reportPath}`);
      console.log(`Stats:  ${result.statsPath}`);
      console.log(`Nodes:  ${result.nodes}`);
      console.log(`Edges:  ${result.edges}`);
    } catch (error) {
      fail('Graph report failed', error);
    } finally {
      memory.close();
    }
  });

contextGraphCommand
  .command('stats')
  .description('Print project graph health and coverage stats')
  .option('-p, --project <project>', 'Project scope')
  .action(async (options) => {
    const memory = createMemory();
    try {
      await memory.init();
      const nodes = projectGraphNodes(memory.context.listContextNodes({
        project: options.project,
        domainType: ContextDomainType.ARCHITECTURE,
        limit: 100000,
      }));
      const edges = projectGraphEdges(memory.context.listContextEdges({ limit: 100000 }));
      console.log(`Nodes: ${nodes.length}`);
      console.log(`Edges: ${edges.length}`);
      printCounts('Kinds', countBy(nodes, (node) => String(node.metadata?.['kind'] ?? 'unknown')));
      printCounts('Provenance', countBy(nodes, (node) => String(node.metadata?.['provenance'] ?? 'unknown')));
    } catch (error) {
      fail('Graph stats failed', error);
    } finally {
      memory.close();
    }
  });

contextGraphCommand
  .command('status')
  .description('Show canonical project graph location and projection status')
  .option('-p, --project <project>', 'Project scope')
  .action(async (options) => {
    const memory = createMemory();
    try {
      await memory.init();
      const nodes = projectGraphNodes(memory.context.listContextNodes({
        project: options.project,
        domainType: ContextDomainType.ARCHITECTURE,
        limit: 100000,
      }));
      const edges = projectGraphEdges(memory.context.listContextEdges({ limit: 100000 }));
      const projections = memory.projections.listProjectionRecords({
        target: undefined,
        limit: 100,
      }).filter((record) => projectGraphProjectionTargets.has(record.target));
      const lines = buildGraphStatusLines({
        mode: process.env['TEAM_SERVER_URL'] ? 'team' : 'local',
        project: options.project ?? '(all)',
        nodes: nodes.length,
        edges: edges.length,
        projections,
      });
      for (const line of lines) console.log(line);
    } catch (error) {
      fail('Graph status failed', error);
    } finally {
      memory.close();
    }
  });

contextGraphCommand
  .command('sync')
  .description('Sync project graph edits: local Obsidian notes become overlays, team mode publishes the graph')
  .option('-C, --cwd <path>', 'Run as if invoked in this directory')
  .option('--vault <path>', 'Obsidian vault path for local mode')
  .option('--team-server-url <url>', 'Team Server URL for team mode')
  .option('--team-api-key <key>', 'Team API key for team mode')
  .action(async (options) => {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const memory = createMemory();
    try {
      await memory.init();
      const project = detectProject(cwd);
      if (!project) throw new Error('Could not detect project.');
      const config = readProjectCliConfig(project.root);
      const plan = resolveGraphSyncPlan({
        projectName: project.name,
        config,
        vaultPath: options.vault,
        teamServerUrl: options.teamServerUrl ?? process.env['TEAM_SERVER_URL'] ?? config?.teamServerUrl,
      });

      if (plan.mode === 'team') {
        memory.context.indexProjectGraph(project);
        const publish = await publishProjectGraphToTeamServer(
          memory,
          project,
          await createGraphSyncTeamClient(plan.teamServerUrl, options.teamApiKey),
        );
        console.log(`Team sync: ${publish.installedNodes} installed, ${publish.updatedNodes} updated`);
        return;
      }

      if (!plan.obsidianFile) {
        throw new Error('No Obsidian vault configured. Pass --vault or run setup/init with a vault.');
      }
      if (!fs.existsSync(plan.obsidianFile)) {
        throw new Error(`Project graph projection not found: ${plan.obsidianFile}`);
      }

      const notes = extractProjectGraphUserNotes(fs.readFileSync(plan.obsidianFile, 'utf8'));
      const created = notes ? upsertObsidianProjectGraphNoteOverlay(memory, project.name, notes) : false;
      const vaultRoot = path.dirname(path.dirname(path.dirname(plan.obsidianFile)));
      const artifacts = memory.context.writeProjectGraphObsidianProjection(project, path.resolve(vaultRoot));
      console.log(`Obsidian sync: ${created ? 'overlay updated' : 'no user notes to import'}`);
      console.log(`Projection: ${artifacts.reportPath}`);
    } catch (error) {
      fail('Graph sync failed', error);
    } finally {
      memory.close();
    }
  });

contextGraphCommand
  .command('query <query>')
  .description('Search focused project graph nodes')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <number>', 'Maximum number of nodes', '10')
  .action(async (query: string, options) => {
    const memory = createMemory();
    try {
      await memory.init();
      const nodes = projectGraphNodes(memory.context.queryContextGraph({
        query,
        project: options.project,
        domainType: ContextDomainType.ARCHITECTURE,
        limit: parseInt(options.limit, 10),
      }));
      printNodes(nodes, false);
    } catch (error) {
      fail('Graph query failed', error);
    } finally {
      memory.close();
    }
  });

contextGraphCommand
  .command('context <id>')
  .description('Show a bounded 360-degree view around a project graph node')
  .option('-l, --limit <number>', 'Maximum neighbor edges', '20')
  .action(async (id: string, options) => {
    const memory = createMemory();
    try {
      await memory.init();
      const node = memory.context.listContextNodes({ limit: 100000 })
        .find((entry) => entry.id === id || entry.title === id);
      if (!node || node.metadata?.['projectGraph'] !== true) {
        console.log('No project graph node matched.');
        return;
      }
      const limit = parseInt(options.limit, 10);
      const outgoing = memory.context.listContextEdges({ sourceId: node.id, limit });
      const incoming = memory.context.listContextEdges({ targetId: node.id, limit });
      const overlays = memory.context.listProjectGraphOverlays({
        project: node.project,
        targetNodeId: node.id,
      });
      printNodes([node], true);
      printOverlays(overlays);
      printEdges('Outgoing', outgoing);
      printEdges('Incoming', incoming);
    } catch (error) {
      fail('Graph context failed', error);
    } finally {
      memory.close();
    }
  });

contextGraphCommand
  .command('path <from> <to>')
  .description('Show the shortest bounded project graph path between two nodes')
  .option('-p, --project <project>', 'Project scope')
  .option('-d, --max-depth <number>', 'Maximum path depth', '6')
  .action(async (from: string, to: string, options) => {
    const memory = createMemory();
    try {
      await memory.init();
      const nodes = memory.context.listContextNodes({
        project: options.project,
        domainType: ContextDomainType.ARCHITECTURE,
        limit: 100000,
      });
      const edges = memory.context.listContextEdges({ limit: 100000 });
      const result = findProjectGraphPath({
        nodes,
        edges,
        from,
        to,
        maxDepth: parseInt(options.maxDepth, 10),
      });
      if (!result.found) {
        console.log('No project graph path found.');
        return;
      }
      printPath(result.nodes, result.edges);
    } catch (error) {
      fail('Graph path failed', error);
    } finally {
      memory.close();
    }
  });

contextGraphCommand
  .command('impact <id>')
  .description('Estimate project graph blast radius around a node')
  .option('-p, --project <project>', 'Project scope')
  .option('-d, --depth <number>', 'Neighbor depth', '1')
  .option('-l, --limit <number>', 'Maximum affected nodes', '20')
  .action(async (id: string, options) => {
    const memory = createMemory();
    try {
      await memory.init();
      const nodes = memory.context.listContextNodes({
        project: options.project,
        domainType: ContextDomainType.ARCHITECTURE,
        limit: 100000,
      });
      const edges = memory.context.listContextEdges({ limit: 100000 });
      const result = estimateProjectGraphBlastRadius({
        nodes,
        edges,
        id,
        depth: parseInt(options.depth, 10),
        limit: parseInt(options.limit, 10),
      });
      if (!result.root) {
        console.log('No project graph node matched.');
        return;
      }
      console.log(`Root: ${result.root.title}`);
      console.log(`Affected nodes: ${result.affectedNodes.length}`);
      printNodes(result.affectedNodes, false);
      printEdges('Edges', result.edges);
    } catch (error) {
      fail('Graph impact failed', error);
    } finally {
      memory.close();
    }
  });

contextGraphCommand
  .command('eval-dataset')
  .description('Export the project graph evaluation dataset report and fixtures')
  .requiredOption('--out <dir>', 'Output directory for the report and fixtures')
  .action((options) => {
    try {
      const outDir = path.resolve(options.out);
      const fixturesDir = path.join(outDir, 'fixtures');
      const fixtures = listProjectGraphEvaluationFixtures();
      const tasks = listProjectGraphEvaluationTasks();
      fs.mkdirSync(fixturesDir, { recursive: true });
      for (const fixture of fixtures) {
        materializeProjectGraphEvaluationFixture(fixture.id, path.join(fixturesDir, fixture.id));
      }
      const reportPath = path.join(outDir, 'project-graph-evaluation-dataset.md');
      fs.writeFileSync(reportPath, renderProjectGraphEvaluationDatasetMarkdown({ fixtures, tasks }), 'utf8');
      for (const line of buildGraphEvaluationDatasetExportLines({
        reportPath,
        fixturesDir,
        fixtureCount: fixtures.length,
        taskCount: tasks.length,
      })) {
        console.log(line);
      }
    } catch (error) {
      fail('Graph evaluation dataset export failed', error);
    }
  });

contextGraphCommand
  .command('ingest')
  .description('Ingest external project graph input from repo-scanner or a custom collector')
  .option('-C, --cwd <path>', 'Run as if invoked in this directory')
  .requiredOption('--changes <file>', 'Path to a ChangeSet JSON file, or - for stdin')
  .action(async (options) => {
    const memory = createMemory();
    try {
      await memory.init();
      const project = detectProject(options.cwd ?? process.cwd());
      if (!project) throw new Error('Could not detect project.');
      const changeSet = parseExternalChangeSetJson(readTextInput(options.changes));
      const result = memory.context.ingestProjectGraphChangeSet(project, changeSet);
      for (const line of buildGraphChangeResultLines(result)) console.log(line);
    } catch (error) {
      fail('Graph ingest failed', error);
    } finally {
      memory.close();
    }
  });

contextGraphCommand
  .command('changes')
  .description('Map workspace or manual file changes onto project graph nodes and risk hints')
  .option('-C, --cwd <path>', 'Run as if invoked in this directory')
  .option('--source <source>', 'Change source: manual or git', 'manual')
  .option('--files <files...>', 'Explicit changed files for manual source')
  .action(async (options) => {
    const memory = createMemory();
    try {
      await memory.init();
      const project = detectProject(options.cwd ?? process.cwd());
      if (!project) throw new Error('Could not detect project.');
      const source = parseChangeSource(options.source);
      const files = source === ChangeSource.GIT
        ? gitChangedFiles(project.root)
        : options.files ?? [];
      const result = detectProjectGraphChanges(memory.context, project, { source, files });
      for (const line of buildGraphChangeResultLines(result)) console.log(line);
    } catch (error) {
      fail('Graph changes failed', error);
    } finally {
      memory.close();
    }
  });

const projectGraphNodes = (nodes: ContextNode[]): ContextNode[] =>
  nodes.filter((node) => node.metadata?.['projectGraph'] === true);

const projectGraphEdges = (edges: ContextEdge[]): ContextEdge[] =>
  edges.filter((edge) => edge.evidence?.['projectGraph'] === true);

const projectGraphProjectionTargets = new Set<ProjectionTarget>([
  ProjectionTarget.PROJECT_GRAPH_REPO_ENTRY,
  ProjectionTarget.PROJECT_GRAPH_OBSIDIAN,
  ProjectionTarget.PROJECT_GRAPH_TEAM_SERVER,
]);

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

export const parseExternalChangeSetJson = (text: string): ChangeSet => {
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value)) throw new Error('ChangeSet JSON must be an object.');
  if (!isChangeSource(value.source)) throw new Error('ChangeSet source is required.');
  if (!Array.isArray(value.files)) throw new Error('ChangeSet files must be an array.');

  return {
    source: value.source,
    base: optionalString(value.base, 'base'),
    head: optionalString(value.head, 'head'),
    files: value.files.map(parseExternalChangedFile),
  };
};

export const resolveGraphSyncPlan = (input: {
  projectName: string;
  config: ProjectCliConfig | null;
  vaultPath?: string;
  teamServerUrl?: string;
}): { mode: 'local' | 'team'; teamServerUrl?: string; obsidianFile?: string } => {
  if (input.teamServerUrl || input.config?.mode === 'team') {
    return {
      mode: 'team',
      teamServerUrl: input.teamServerUrl ?? input.config?.teamServerUrl,
      obsidianFile: undefined,
    };
  }
  const vaultPath = input.vaultPath ?? input.config?.vaultPath;
  return {
    mode: 'local',
    teamServerUrl: undefined,
    obsidianFile: vaultPath
      ? path.join(vaultPath, slugifyProjectName(input.projectName), 'architecture', 'project-graph.md')
      : undefined,
  };
};

export const extractProjectGraphUserNotes = (text: string): string => {
  const start = '<!-- mindstrate:project-graph:user-notes:start -->';
  const end = '<!-- mindstrate:project-graph:user-notes:end -->';
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return '';
  const notes = text.slice(startIndex + start.length, endIndex).trim();
  return notes === '- Add architecture notes, confirmations, corrections, or risks here.' ? '' : notes;
};

const upsertObsidianProjectGraphNoteOverlay = (
  memory: ReturnType<typeof createMemory>,
  project: string,
  content: string,
): boolean => {
  const existing = memory.context.listProjectGraphOverlays({ project, limit: 500 })
    .find((overlay) =>
      overlay.source === ProjectGraphOverlaySource.OBSIDIAN
      && overlay.kind === ProjectGraphOverlayKind.NOTE
      && !overlay.targetNodeId
      && !overlay.targetEdgeId
      && overlay.content === content);
  if (existing) return false;
  memory.context.createProjectGraphOverlay({
    project,
    kind: ProjectGraphOverlayKind.NOTE,
    content,
    source: ProjectGraphOverlaySource.OBSIDIAN,
    author: 'obsidian',
  });
  return true;
};

async function createGraphSyncTeamClient(
  serverUrl?: string,
  apiKey?: string,
): Promise<ProjectGraphTeamClient> {
  if (!serverUrl) throw new Error('TEAM_SERVER_URL or --team-server-url is required for team graph sync.');
  const clientPackage = '@mindstrate/client';
  const { TeamClient } = await import(clientPackage);
  return new TeamClient({
    serverUrl,
    apiKey: apiKey ?? process.env['TEAM_API_KEY'],
  });
}

const slugifyProjectName = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';

const printNodes = (nodes: ContextNode[], verbose: boolean): void => {
  if (nodes.length === 0) {
    console.log('No project graph nodes matched.');
    return;
  }
  for (const node of nodes) {
    console.log(`[${node.metadata?.['kind'] ?? 'node'}] ${node.title}`);
    console.log(`  ID: ${node.id}`);
    console.log(`  Provenance: ${node.metadata?.['provenance'] ?? 'unknown'}`);
    console.log(`  Evidence: ${evidencePaths(node).join(', ') || '(none)'}`);
    console.log(`  Content: ${verbose ? node.content : truncate(node.content, 120)}`);
    console.log('');
  }
};

const printOverlays = (overlays: ProjectGraphOverlay[]): void => {
  for (const line of buildGraphOverlayLines(overlays)) console.log(line);
  console.log('');
};

const printEdges = (label: string, edges: ContextEdge[]): void => {
  console.log(`${label}: ${edges.length}`);
  for (const edge of projectGraphEdges(edges)) {
    console.log(`  ${edge.relationType}: ${edge.sourceId} -> ${edge.targetId}`);
  }
};

const printPath = (nodes: ContextNode[], edges: ContextEdge[]): void => {
  console.log(`Path nodes: ${nodes.length}`);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    console.log(`  ${index + 1}. [${node.metadata?.['kind'] ?? 'node'}] ${node.title}`);
    const edge = edges[index];
    if (edge) {
      console.log(`     ${edge.evidence?.['kind'] ?? edge.relationType}`);
    }
  }
};

const evidencePaths = (node: ContextNode): string[] => {
  const evidence = node.metadata?.['evidence'];
  return Array.isArray(evidence)
    ? evidence.map((entry) => typeof entry === 'object' && entry && 'path' in entry ? String(entry.path) : '')
      .filter(Boolean)
    : [];
};

const printCounts = (label: string, counts: Record<string, number>): void => {
  console.log(`\n${label}:`);
  for (const [key, count] of Object.entries(counts).sort()) {
    console.log(`  ${key}: ${count}`);
  }
};

const countBy = <T>(items: T[], keyFor: (item: T) => string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

const parseChangeSource = (value: string): ChangeSource => {
  if (value === ChangeSource.GIT) return ChangeSource.GIT;
  if (value === ChangeSource.MANUAL) return ChangeSource.MANUAL;
  throw new Error(`Unsupported graph changes source: ${value}`);
};

const parseExternalChangedFile = (value: unknown): ChangeSet['files'][number] => {
  if (!isRecord(value)) throw new Error('Changed file entries must be objects.');
  const filePath = requiredString(value.path, 'path').replace(/\\/g, '/');
  const status = value.status;
  if (!isChangedFileStatus(status)) throw new Error(`Unsupported changed file status: ${String(status)}`);
  return {
    path: filePath,
    status,
    oldPath: optionalString(value.oldPath, 'oldPath')?.replace(/\\/g, '/'),
    language: optionalString(value.language, 'language'),
    layerId: optionalString(value.layerId, 'layerId'),
  };
};

const readTextInput = (inputPath: string): string =>
  inputPath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(inputPath), 'utf8');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isChangeSource = (value: unknown): value is ChangeSource =>
  Object.values(ChangeSource).includes(value as ChangeSource);

const isChangedFileStatus = (value: unknown): value is ChangedFileStatus =>
  value === 'added' || value === 'modified' || value === 'deleted' || value === 'renamed' || value === 'moved';

const requiredString = (value: unknown, field: string): string => {
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error(`Changed file ${field} is required.`);
};

const optionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  throw new Error(`ChangeSet ${field} must be a string when provided.`);
};

const gitChangedFiles = (cwd: string): string[] => {
  const output = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
  return output.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
};

const fail = (prefix: string, error: unknown): never => {
  console.error(`${prefix}:`, errorMessage(error));
  process.exit(1);
};
