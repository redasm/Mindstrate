import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ChangeSource,
  checkGeneratedEditSafety,
  checkUnrealModuleBoundaryConsistency,
  checkUnrealPluginDependencyConsistency,
  ContextDomainType,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectionTarget,
  detectProject,
  errorMessage,
  estimateProjectGraphBlastRadius,
  findProjectGraphPath,
  listProjectGraphEvaluationFixtures,
  listProjectGraphEvaluationTasks,
  materializeProjectGraphEvaluationFixture,
  renderProjectGraphEvaluationDatasetMarkdown,
  queryProjectGraphTask,
  type ContextNode,
  type ProjectGraphTaskQuery,
} from '@mindstrate/server';
import { readProjectCliConfig } from '../cli-config.js';
import { createMemory } from '../memory-factory.js';
import { formatProjectGraphEnrichment, publishProjectGraphToTeamServer, runProjectGraphEnrichment } from './init.js';
import { gitChangedFiles, parseChangeSource, parseExternalChangeSetJson } from './graph-parsers.js';
import {
  buildGraphChangeResultLines,
  buildGraphEvaluationDatasetExportLines,
  buildGraphStatusLines,
  countBy,
  printCounts,
  printEdges,
  printNodes,
  printOverlays,
  printPath,
  printTaskQueryResult,
} from './graph-render.js';
import { PROJECT_GRAPH_CLI_QUERY_LIMIT, projectGraphEdges, projectGraphNodes } from './graph-selectors.js';
import {
  createGraphSyncTeamClient,
  extractProjectGraphUserNotes,
  resolveGraphSyncPlan,
  upsertObsidianProjectGraphNoteOverlay,
} from './graph-sync.js';

export const contextGraphCommand = new Command('graph')
  .description('Query Mindstrate project graph');

contextGraphCommand.command('report')
  .description('Regenerate PROJECT_GRAPH.md and .mindstrate/project-graph.json')
  .option('-C, --cwd <path>', 'Run as if invoked in this directory')
  .action(async (options) => withMemory('Graph report failed', async (memory) => {
    const project = detectProject(options.cwd ?? process.cwd());
    if (!project) throw new Error('Could not detect project.');
    const result = memory.context.writeProjectGraphArtifacts(project);
    console.log(`Report: ${result.reportPath}`);
    console.log(`Stats:  ${result.statsPath}`);
    console.log(`Nodes:  ${result.nodes}`);
    console.log(`Edges:  ${result.edges}`);
  }));

contextGraphCommand.command('index')
  .description('Index the project graph with scan and extraction progress, then write artifacts')
  .option('-C, --cwd <path>', 'Run as if invoked in this directory')
  .action(async (options) => withMemory('Graph index failed', async (memory) => {
    const project = detectProject(options.cwd ?? process.cwd());
    if (!project) throw new Error('Could not detect project.');
    const result = memory.context.indexProjectGraph(project, {
      onScanProgress: (event) => {
        if (event.phase === 'file' && event.files % 100 !== 0) return;
        console.log(`scan ${event.phase}: ${event.path || '.'} files=${event.files} dirs=${event.directories} generated=${event.generatedFiles} skipped=${event.skippedFiles}`);
      },
      onIndexProgress: (event) => {
        console.log(`index ${event.phase}: ${event.filesProcessed}/${event.filesTotal} nodes=${event.nodes} edges=${event.edges} generated=${event.generatedFiles} metadataOnlyRoots=${event.metadataOnlyRoots} skipped=${event.skippedFiles}`);
      },
    });
    const artifacts = memory.context.writeProjectGraphArtifacts(project);
    console.log(`Indexed: ${result.filesScanned} files, ${result.nodesExtracted} nodes, ${result.edgesExtracted} edges`);
    console.log(`Report: ${artifacts.reportPath}`);
    if (result.nodesExtracted <= result.filesScanned) console.log('Warning: graph may be shallow; configure parser adapters, source roots, or metadata imports for richer graph facts.');
  }));

contextGraphCommand.command('stats')
  .description('Print project graph health and coverage stats')
  .option('-p, --project <project>', 'Project scope')
  .action(async (options) => withMemory('Graph stats failed', async (memory) => {
    const nodes = projectGraphNodes(memory.context.listContextNodes({
      project: options.project,
      domainType: ContextDomainType.ARCHITECTURE,
      limit: PROJECT_GRAPH_CLI_QUERY_LIMIT,
    }));
    const edges = projectGraphEdges(memory.context.listContextEdges({ limit: PROJECT_GRAPH_CLI_QUERY_LIMIT }));
    console.log(`Nodes: ${nodes.length}`);
    console.log(`Edges: ${edges.length}`);
    printCounts('Kinds', countBy(nodes, (node) => String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? 'unknown')));
    printCounts('Provenance', countBy(nodes, (node) => String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.provenance] ?? 'unknown')));
  }));

contextGraphCommand.command('status')
  .description('Show canonical project graph location and projection status')
  .option('-p, --project <project>', 'Project scope')
  .action(async (options) => withMemory('Graph status failed', async (memory) => {
    const nodes = projectGraphNodes(memory.context.listContextNodes({
      project: options.project,
      domainType: ContextDomainType.ARCHITECTURE,
      limit: PROJECT_GRAPH_CLI_QUERY_LIMIT,
    }));
    const edges = projectGraphEdges(memory.context.listContextEdges({ limit: PROJECT_GRAPH_CLI_QUERY_LIMIT }));
    const projections = memory.projections.listProjectionRecords({ limit: 100 })
      .filter((record) => projectGraphProjectionTargets.has(record.target));
    for (const line of buildGraphStatusLines({
      mode: process.env['TEAM_SERVER_URL'] ? 'team' : 'local',
      project: options.project ?? '(all)',
      nodes: nodes.length,
      edges: edges.length,
      projections,
    })) console.log(line);
  }));

contextGraphCommand.command('sync')
  .description('Sync project graph edits: local Obsidian notes become overlays, team mode publishes the graph')
  .option('-C, --cwd <path>', 'Run as if invoked in this directory')
  .option('--vault <path>', 'Obsidian vault path for local mode')
  .option('--team-server-url <url>', 'Team Server URL for team mode')
  .option('--team-api-key <key>', 'Team API key for team mode')
  .action(async (options) => withMemory('Graph sync failed', async (memory) => {
    const project = detectProject(path.resolve(options.cwd ?? process.cwd()));
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
      const publish = await publishProjectGraphToTeamServer(memory, project, await createGraphSyncTeamClient(plan.teamServerUrl, options.teamApiKey));
      console.log(`Team sync: ${publish.installedNodes} installed, ${publish.updatedNodes} updated`);
      return;
    }
    if (!plan.obsidianFile) throw new Error('No Obsidian vault configured. Pass --vault or run setup/init with a vault.');
    if (!fs.existsSync(plan.obsidianFile)) throw new Error(`Project graph projection not found: ${plan.obsidianFile}`);
    const notes = extractProjectGraphUserNotes(fs.readFileSync(plan.obsidianFile, 'utf8'));
    const created = notes ? upsertObsidianProjectGraphNoteOverlay(memory, project.name, notes) : false;
    const graph = memory.context.indexProjectGraph(project);
    const enrichment = await runProjectGraphEnrichment(memory, project);
    const vaultRoot = path.dirname(path.dirname(path.dirname(plan.obsidianFile)));
    const artifacts = memory.context.writeProjectGraphObsidianProjection(project, path.resolve(vaultRoot));
    console.log(`Obsidian sync: ${created ? 'overlay updated' : 'no user notes to import'}`);
    console.log(`Graph index: ${graph.filesScanned} files, ${graph.nodesCreated + graph.nodesUpdated} nodes, ${graph.edgesCreated + graph.edgesUpdated} edges`);
    console.log(`LLM enrichment: ${formatProjectGraphEnrichment(enrichment)}`);
    console.log(`Projection: ${artifacts.reportPath}`);
  }));

contextGraphCommand.command('query <query>')
  .description('Search focused project graph nodes')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <number>', 'Maximum number of nodes', '10')
  .action(async (query: string, options) => withMemory('Graph query failed', async (memory) => {
    printNodes(projectGraphNodes(memory.context.queryContextGraph({
      query,
      project: options.project,
      domainType: ContextDomainType.ARCHITECTURE,
      limit: parseInt(options.limit, 10),
    })), false);
  }));

contextGraphCommand.command('context <id>')
  .description('Show a bounded 360-degree view around a project graph node')
  .option('-l, --limit <number>', 'Maximum neighbor edges', '20')
  .action(async (id: string, options) => withMemory('Graph context failed', async (memory) => {
    const node = findProjectGraphNode(memory, id);
    if (!node) {
      console.log('No project graph node matched.');
      return;
    }
    const limit = parseInt(options.limit, 10);
    const outgoing = projectGraphEdges(memory.context.listContextEdges({ sourceId: node.id, limit }));
    const incoming = projectGraphEdges(memory.context.listContextEdges({ targetId: node.id, limit }));
    printNodes([node], true);
    printOverlays(memory.context.listProjectGraphOverlays({ project: node.project, targetNodeId: node.id }));
    printEdges('Outgoing', outgoing);
    printEdges('Incoming', incoming);
  }));

contextGraphCommand.command('path <from> <to>')
  .description('Show the shortest bounded project graph path between two nodes')
  .option('-p, --project <project>', 'Project scope')
  .option('-d, --max-depth <number>', 'Maximum path depth', '6')
  .action(async (from: string, to: string, options) => withMemory('Graph path failed', async (memory) => {
    const result = findProjectGraphPath({
      nodes: memory.context.listContextNodes({ project: options.project, domainType: ContextDomainType.ARCHITECTURE, limit: PROJECT_GRAPH_CLI_QUERY_LIMIT }),
      edges: memory.context.listContextEdges({ limit: PROJECT_GRAPH_CLI_QUERY_LIMIT }),
      from,
      to,
      maxDepth: parseInt(options.maxDepth, 10),
    });
    if (!result.found) {
      console.log('No project graph path found.');
      return;
    }
    printPath(result.nodes, result.edges);
  }));

contextGraphCommand.command('impact <id>')
  .description('Estimate project graph blast radius around a node')
  .option('-p, --project <project>', 'Project scope')
  .option('-d, --depth <number>', 'Neighbor depth', '1')
  .option('-l, --limit <number>', 'Maximum affected nodes', '20')
  .action(async (id: string, options) => withMemory('Graph impact failed', async (memory) => {
    const result = estimateProjectGraphBlastRadius({
      nodes: memory.context.listContextNodes({ project: options.project, domainType: ContextDomainType.ARCHITECTURE, limit: PROJECT_GRAPH_CLI_QUERY_LIMIT }),
      edges: memory.context.listContextEdges({ limit: PROJECT_GRAPH_CLI_QUERY_LIMIT }),
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
  }));

contextGraphCommand.command('task <task> [query]')
  .description('Run a task-oriented project graph query template')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <number>', 'Maximum graph items', '10')
  .option('--json', 'Also print compact JSON for agents')
  .action(async (task: string, query: string | undefined, options) => withMemory('Graph task query failed', async (memory) => {
    const graphTask = parseGraphTask(task);
    const project = detectProject(process.cwd()) ?? undefined;
    const result = queryProjectGraphTask({
      project,
      nodes: memory.context.listContextNodes({ project: options.project, domainType: ContextDomainType.ARCHITECTURE, limit: PROJECT_GRAPH_CLI_QUERY_LIMIT }),
      edges: memory.context.listContextEdges({ limit: PROJECT_GRAPH_CLI_QUERY_LIMIT }),
      task: graphTask,
      query,
      limit: parseInt(options.limit, 10),
    });
    printTaskQueryResult(result, options.json === true);
  }));

contextGraphCommand.command('eval-dataset')
  .description('Export the project graph evaluation dataset report and fixtures')
  .requiredOption('--out <dir>', 'Output directory for the report and fixtures')
  .action((options) => {
    try {
      const outDir = path.resolve(options.out);
      const fixturesDir = path.join(outDir, 'fixtures');
      const fixtures = listProjectGraphEvaluationFixtures();
      const tasks = listProjectGraphEvaluationTasks();
      fs.mkdirSync(fixturesDir, { recursive: true });
      for (const fixture of fixtures) materializeProjectGraphEvaluationFixture(fixture.id, path.join(fixturesDir, fixture.id));
      const reportPath = path.join(outDir, 'project-graph-evaluation-dataset.md');
      fs.writeFileSync(reportPath, renderProjectGraphEvaluationDatasetMarkdown({ fixtures, tasks }), 'utf8');
      for (const line of buildGraphEvaluationDatasetExportLines({ reportPath, fixturesDir, fixtureCount: fixtures.length, taskCount: tasks.length })) console.log(line);
    } catch (error) {
      fail('Graph evaluation dataset export failed', error);
    }
  });

contextGraphCommand.command('ingest')
  .description('Ingest external project graph input from repo-scanner or a custom collector')
  .option('-C, --cwd <path>', 'Run as if invoked in this directory')
  .requiredOption('--changes <file>', 'Path to a ChangeSet JSON file, or - for stdin')
  .action(async (options) => withMemory('Graph ingest failed', async (memory) => {
    const project = detectProject(options.cwd ?? process.cwd());
    if (!project) throw new Error('Could not detect project.');
    const result = memory.context.ingestProjectGraphChangeSet(project, parseExternalChangeSetJson(readTextInput(options.changes)));
    for (const line of buildGraphChangeResultLines({
      ...result,
      safetyIssues: collectGraphSafetyIssues(project, memory, result.changeSet.files.map((file) => file.path)),
    })) console.log(line);
  }));

contextGraphCommand.command('changes')
  .description('Map workspace or manual file changes onto project graph nodes and risk hints')
  .option('-C, --cwd <path>', 'Run as if invoked in this directory')
  .option('--source <source>', 'Change source: manual or git', 'manual')
  .option('--files <files...>', 'Explicit changed files for manual source')
  .action(async (options) => withMemory('Graph changes failed', async (memory) => {
    const project = detectProject(options.cwd ?? process.cwd());
    if (!project) throw new Error('Could not detect project.');
    const source = parseChangeSource(options.source);
    const files = source === ChangeSource.GIT ? gitChangedFiles(project.root) : options.files ?? [];
    const result = memory.context.detectProjectGraphChanges(project, { source, files });
    for (const line of buildGraphChangeResultLines({
      ...result,
      safetyIssues: collectGraphSafetyIssues(project, memory, files),
    })) console.log(line);
  }));

const projectGraphProjectionTargets = new Set<ProjectionTarget>([
  ProjectionTarget.PROJECT_GRAPH_REPO_ENTRY,
  ProjectionTarget.PROJECT_GRAPH_OBSIDIAN,
  ProjectionTarget.PROJECT_GRAPH_TEAM_SERVER,
]);

const projectGraphTasks = new Set<ProjectGraphTaskQuery>([
  'entry-points',
  'module',
  'before-edit',
  'binding',
  'asset-references',
  'flow',
  'impact',
  'explain',
]);

const parseGraphTask = (value: string): ProjectGraphTaskQuery => {
  if (projectGraphTasks.has(value as ProjectGraphTaskQuery)) return value as ProjectGraphTaskQuery;
  throw new Error(`Unknown graph task: ${value}. Expected one of: ${Array.from(projectGraphTasks).join(', ')}`);
};

const findProjectGraphNode = (memory: ReturnType<typeof createMemory>, id: string): ContextNode | null => {
  const direct = memory.context.getContextNode(id);
  if (direct && direct.metadata?.[PROJECT_GRAPH_METADATA_KEYS.projectGraph] === true) return direct;
  return projectGraphNodes(memory.context.listContextNodes({ limit: PROJECT_GRAPH_CLI_QUERY_LIMIT }))
    .find((entry) => entry.title === id) ?? null;
};

const collectGraphSafetyIssues = (
  project: NonNullable<ReturnType<typeof detectProject>>,
  memory: ReturnType<typeof createMemory>,
  changedFiles: string[],
): { severity: string; code: string; message: string; evidence?: string[] }[] => {
  const nodes = memory.context.listContextNodes({
    project: project.name,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_CLI_QUERY_LIMIT,
  });
  const edges = memory.context.listContextEdges({ limit: PROJECT_GRAPH_CLI_QUERY_LIMIT });
  return [
    ...checkGeneratedEditSafety({
      changedFiles,
      nodes,
      edges,
      generatedRoots: project.graphHints?.generatedRoots,
    }),
    ...checkUnrealPluginDependencyConsistency({ nodes, edges }),
    ...checkUnrealModuleBoundaryConsistency({ nodes, edges }),
  ];
};

const withMemory = async (
  failurePrefix: string,
  work: (memory: ReturnType<typeof createMemory>) => Promise<void> | void,
): Promise<void> => {
  const memory = createMemory();
  try {
    await memory.init();
    await work(memory);
  } catch (error) {
    fail(failurePrefix, error);
  } finally {
    memory.close();
  }
};

const readTextInput = (inputPath: string): string =>
  inputPath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(inputPath), 'utf8');

const fail = (prefix: string, error: unknown): never => {
  console.error(`${prefix}:`, errorMessage(error));
  process.exit(1);
};
