/**
 * Local-personal flavor of `mindstrate setup`.
 *
 * Splits the local initialization concerns out of the command-action file:
 *   - Environment plumbing: persist `.env` and (separately) inject into
 *     the current process. The two side effects used to be fused inside
 *     `applySetupLlmEnvironment`, which made it possible for a second
 *     setup run with different LLM credentials to silently inherit the
 *     first run's `process.env`.
 *   - Local Mindstrate bootstrap: opens the per-project SQLite store,
 *     writes the project snapshot, indexes the project graph, optionally
 *     runs LLM enrichment / system-page planning, materializes the
 *     graph, and persists the project meta file.
 *   - Vault export wrapper used when the user chose to wire an Obsidian
 *     vault during setup.
 */

import * as path from 'node:path';
import {
  Mindstrate,
  consoleLogger,
  errorMessage,
  loadProjectMeta,
  saveProjectMeta,
  dependencyFingerprint,
  metaPath,
  type DetectedProject,
} from '@mindstrate/server';
import { SyncManager, VaultLayout } from '@mindstrate/obsidian-sync';
import { buildProjectGraphAnalysisLines } from './init.js';
import {
  printIndexProgress,
  printScanProgress,
  printStepProgress,
  type SetupProgress,
} from './setup-progress.js';
import { normalizeOptionalPath } from './setup-prompts.js';

export interface InitializeLocalProjectOptions {
  vaultPath?: string;
  onProgress?: SetupProgress;
}

export async function initializeLocalProject(
  project: DetectedProject,
  dataDir: string,
  options: InitializeLocalProjectOptions = {},
): Promise<void> {
  const vaultPath = normalizeOptionalPath(options.vaultPath);
  options.onProgress?.('Opening local memory database');
  const memory = new Mindstrate({ dataDir, logger: consoleLogger });
  try {
    await runSetupStage('opening local memory database', () => memory.init());
    options.onProgress?.('Writing project snapshot');
    const previousMeta = loadProjectMeta(project.root);
    const now = new Date().toISOString();
    const result = await runSetupStage('writing project snapshot', () =>
      memory.snapshots.upsertProjectSnapshot(project, { author: 'mindstrate-setup' }));
    options.onProgress?.('Scanning project graph scope');
    const scanScopeProgress = printScanProgress('Scan scope');
    const scope = await runSetupStage('scanning project graph scope', () => {
      const value = memory.context.estimateProjectGraphScanScope(project, {
        onScanProgress: scanScopeProgress,
      });
      scanScopeProgress.flush();
      return value;
    });
    for (const line of buildProjectGraphAnalysisLines({
      projectName: project.name,
      ...scope,
    })) console.log(`  ${line}`);
    options.onProgress?.('Indexing project graph');
    const indexProgress = printScanProgress('Index graph');
    const extractionProgress = printIndexProgress('Index graph');
    const graph = await runSetupStage('indexing project graph', () => {
      const value = memory.context.indexProjectGraph(project, {
        onScanProgress: indexProgress,
        onIndexProgress: extractionProgress,
      });
      indexProgress.flush();
      extractionProgress.flush();
      return value;
    });
    options.onProgress?.('Running optional LLM enrichment');
    const enrichment = await runLlmEnrichment(memory, project);
    const systemPages = vaultPath ? await runLlmSystemPagePlanning(memory, project) : null;
    options.onProgress?.('Writing project graph artifacts');
    const artifacts = await runSetupStage('writing project graph artifacts', () => vaultPath
      ? memory.context.writeProjectGraphObsidianProjection(project, path.resolve(vaultPath), {
        systemPages: systemPages ?? undefined,
      })
      : memory.context.writeProjectGraphArtifacts(project));
    options.onProgress?.('Saving project metadata');
    await runSetupStage('saving project metadata', () => saveProjectMeta(project.root, {
      version: 1,
      name: project.name,
      rootHint: project.root,
      language: project.language,
      framework: project.framework,
      snapshotKnowledgeId: result.view.id,
      createdAt: previousMeta?.createdAt ?? now,
      updatedAt: now,
      fingerprint: dependencyFingerprint({
        language: project.language,
        framework: project.framework,
        dependencies: project.dependencies,
      }),
    }));
    console.log(`  Project snapshot: ${result.changed ? 'updated' : 'up-to-date'} (${result.view.id})`);
    console.log(`  Project graph enrichment: ${formatSetupEnrichment(enrichment)}`);
    console.log(`  Project graph: ${graph.filesScanned} files, ${graph.nodesCreated + graph.nodesUpdated} nodes (${artifacts.reportPath})`);
    console.log(`  Meta: ${metaPath(project.root)}`);
  } finally {
    memory.close();
  }
}

export async function exportVaultDuringSetup(
  dataDir: string,
  vaultPath: string,
  onProgress?: SetupProgress,
): Promise<void> {
  onProgress?.('Opening local memory database');
  const root = path.resolve(vaultPath);
  const layout = new VaultLayout({ vaultRoot: root });
  layout.ensureRoot();
  const memory = new Mindstrate({ dataDir, logger: consoleLogger });
  await memory.init();
  onProgress?.('Exporting vault markdown');
  const sync = new SyncManager(memory, { vaultRoot: root });
  const result = await sync.exportAll();
  console.log(`  Vault export: ${result.written} written, ${result.skipped} skipped`);
  memory.close();
}

async function runLlmEnrichment(
  memory: Mindstrate,
  project: DetectedProject,
): Promise<Awaited<ReturnType<Mindstrate['context']['enrichProjectGraph']>> | { status: 'failed'; message: string }> {
  try {
    return await memory.context.enrichProjectGraph(project);
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`  Project graph enrichment skipped: ${message}`);
    return { status: 'failed', message };
  }
}

async function runLlmSystemPagePlanning(
  memory: Mindstrate,
  project: DetectedProject,
): Promise<Awaited<ReturnType<Mindstrate['context']['planProjectGraphSystemPages']>> | null> {
  try {
    return await memory.context.planProjectGraphSystemPages(project);
  } catch (error) {
    console.warn(`  Project graph system page planning skipped: ${errorMessage(error)}`);
    return null;
  }
}

function formatSetupEnrichment(
  enrichment: Awaited<ReturnType<Mindstrate['context']['enrichProjectGraph']>> | { status: 'failed'; message: string },
): string {
  if (enrichment.status === 'failed') return `failed (${enrichment.message})`;
  if (enrichment.status === 'skipped') return `skipped (${enrichment.reason})`;
  if (enrichment.status === 'noop') return enrichment.reason ? `noop (${enrichment.reason})` : 'noop';
  return `enriched (${enrichment.nodesCreated} created, ${enrichment.nodesUpdated} updated)`;
}

async function runSetupStage<T>(stage: string, work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new Error(`${stage} failed: ${errorMessage(error)}`);
  }
}
