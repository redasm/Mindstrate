/**
 * CLI Command: graph
 *
 * Focused project graph commands. These commands expose bounded graph context
 * for humans and MCP clients rather than dumping the entire ECS graph.
 */

import { Command } from 'commander';
import {
  ChangeSource,
  ContextDomainType,
  type ContextEdge,
  type ContextNode,
} from '@mindstrate/server';
import { detectProject, detectProjectGraphChanges, errorMessage, truncateText as truncate } from '@mindstrate/server';
import { execSync } from 'node:child_process';
import { createMemory } from '../memory-factory.js';

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
      printNodes([node], true);
      printEdges('Outgoing', outgoing);
      printEdges('Incoming', incoming);
    } catch (error) {
      fail('Graph context failed', error);
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
      console.log(`Source: ${result.changeSet.source}`);
      console.log(`Files: ${result.changeSet.files.length}`);
      console.log(`Affected nodes: ${result.affectedNodeIds.length}`);
      console.log(`Affected layers: ${result.affectedLayers.join(', ') || '(none)'}`);
      if (result.riskHints.length > 0) {
        console.log('\nRisk hints:');
        for (const hint of result.riskHints) console.log(`  - ${hint}`);
      }
      console.log('\nSuggested queries:');
      for (const query of result.suggestedQueries) console.log(`  - ${query}`);
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

const printEdges = (label: string, edges: ContextEdge[]): void => {
  console.log(`${label}: ${edges.length}`);
  for (const edge of projectGraphEdges(edges)) {
    console.log(`  ${edge.relationType}: ${edge.sourceId} -> ${edge.targetId}`);
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
