import {
  CaptureSource,
  ChangeSource,
  errorMessage,
  Mindstrate,
  KnowledgeExtractor,
  detectProject,
  type CommitInfo,
  type DetectedProject,
  type ProjectGraphScanProgress,
} from '@mindstrate/server';
import { getHeadCommit, listCommitsSince, listRecentCommits, readCommit } from './git-scanner.js';
import { ensureGitClone } from './git-clone.js';
import {
  getChangelistInfo,
  getRecentChangelists,
  listChangelistsSince,
  findP4WorkspaceRoot,
  type P4Env,
} from './p4-source.js';
import { createKnowledgeSink, type KnowledgeSink } from './knowledge-sink.js';
import type {
  CommitIngestionOptions,
  CommitIngestionResult,
  GitLocalSourceInput,
  P4SourceInput,
  RepoScannerMindstrateInput,
  RepoScannerSourceAdapter,
  ScanExecutionResult,
  ScanSource,
} from './types.js';

export interface RepoScannerOptions {
  memory: Mindstrate;
}

export class RepoScannerService {
  readonly scanner: Mindstrate['scanner'];
  private sink: KnowledgeSink;
  private extractor: KnowledgeExtractor;
  private readonly memory: Mindstrate;

  constructor(options: RepoScannerOptions) {
    this.memory = options.memory;
    this.scanner = options.memory.scanner;
    this.sink = createKnowledgeSink(options.memory);
    this.extractor = new KnowledgeExtractor(options.memory.providerFactory);
  }

  async init(): Promise<void> {
    await this.sink.init();
  }

  addGitLocalSource(input: GitLocalSourceInput): ScanSource {
    return this.scanner.createGitLocalSource(input);
  }

  addP4Source(input: P4SourceInput): ScanSource {
    return this.scanner.createP4Source(input);
  }

  listSources(): ScanSource[] {
    return this.scanner.listSources();
  }

  enableSource(sourceId: string): void {
    this.scanner.setSourceEnabled(sourceId, true);
  }

  disableSource(sourceId: string): void {
    this.scanner.setSourceEnabled(sourceId, false);
  }

  deleteSource(sourceId: string): boolean {
    return this.scanner.deleteSource(sourceId);
  }

  listRuns(sourceId: string) {
    return this.scanner.listRuns(sourceId);
  }

  listFailedItems(sourceId: string) {
    return this.scanner.listFailedItems(sourceId);
  }

  getSourceStatus(sourceId: string) {
    const source = this.scanner.getSource(sourceId);
    if (!source) {
      throw new Error(`Unknown source: ${sourceId}`);
    }

    return {
      source,
      recentRuns: this.scanner.listRuns(sourceId),
      failedItems: this.scanner.listFailedItems(sourceId),
    };
  }

  async runSource(sourceId: string): Promise<ScanExecutionResult> {
    const source = this.scanner.getSource(sourceId);
    if (!source) {
      throw new Error(`Unknown source: ${sourceId}`);
    }
    if (!source.enabled) {
      throw new Error(`Source is disabled: ${sourceId}`);
    }
    if (this.scanner.hasRunningRun(sourceId)) {
      throw new Error(`Source is already running: ${sourceId}`);
    }

    this.scanner.markRunStart(sourceId);
    const run = this.scanner.createRun(sourceId);

    try {
      const result = source.kind === 'p4'
        ? await this.executeP4Source(source, run.id)
        : await this.executeGitLocalSource(source, run.id);
      this.scanner.finishRun(run.id, 'completed', {
        itemsSeen: result.itemsSeen,
        itemsImported: result.itemsImported,
        itemsSkipped: result.itemsSkipped,
        itemsFailed: result.itemsFailed,
      });
      if (result.cursor) {
        this.scanner.updateCursor(sourceId, result.cursor);
      }
      return result;
    } catch (error) {
      const message = errorMessage(error);
      this.scanner.markError(sourceId, message);
      this.scanner.finishRun(run.id, 'failed', {
        itemsSeen: 0,
        itemsImported: 0,
        itemsSkipped: 0,
        itemsFailed: 1,
        error: message,
      });
      throw error;
    }
  }

  async retryFailedItems(sourceId: string): Promise<ScanExecutionResult> {
    const source = this.scanner.getSource(sourceId);
    if (!source) throw new Error(`Unknown source: ${sourceId}`);

    const failedItems = this.scanner.listFailedItems(sourceId);
    let itemsImported = 0;
    let itemsSkipped = 0;
    let itemsFailed = 0;

    for (const failed of failedItems) {
      try {
        const commit = source.kind === 'p4'
          ? getChangelistInfo(failed.externalId.replace(/^p4@/, ''), p4EnvOf(source))
          : readCommit(source.repoPath!, failed.externalId);
        if (!commit) {
          itemsFailed++;
          this.scanner.recordFailedItem(source.id, failed.externalId, 'item no longer readable');
          continue;
        }
        const imported = await this.processCommit(source, commit);
        if (imported === 'imported') {
          itemsImported++;
          this.scanner.deleteFailedItem(failed.id);
        } else if (imported === 'skipped') {
          itemsSkipped++;
          this.scanner.deleteFailedItem(failed.id);
        } else {
          itemsFailed++;
          this.scanner.recordFailedItem(source.id, failed.externalId, 'retry failed');
        }
      } catch (error) {
        itemsFailed++;
        this.scanner.recordFailedItem(
          source.id,
          failed.externalId,
          errorMessage(error),
        );
      }
    }

    return {
      sourceId,
      mode: 'incremental',
      itemsSeen: failedItems.length,
      itemsImported,
      itemsSkipped,
      itemsFailed,
      cursor: source.lastCursor,
    };
  }

  async runAdapter<TItem>(
    adapter: RepoScannerSourceAdapter<TItem>,
    input?: { sourceId?: string; cursor?: string },
  ): Promise<ScanExecutionResult> {
    const sourceId = input?.sourceId ?? adapter.id;
    const discovered = await adapter.discover({ sourceId, cursor: input?.cursor });
    let itemsImported = 0;
    let itemsSkipped = 0;
    let itemsFailed = 0;

    for (const item of discovered.items) {
      try {
        await this.routeMindstrateInput(await adapter.toMindstrateInput(item));
        itemsImported++;
      } catch {
        itemsFailed++;
      }
    }

    return {
      sourceId,
      mode: 'incremental',
      itemsSeen: discovered.items.length,
      itemsImported,
      itemsSkipped,
      itemsFailed,
      cursor: discovered.cursor,
    };
  }

  async close(): Promise<void> {
    await this.sink.close();
  }

  async ingestCommit(options: CommitIngestionOptions): Promise<CommitIngestionResult> {
    const { project, commit, recordGitActivity = false, dryRun = false } = options;

    if (recordGitActivity) {
      await this.sink.ingestGitActivity({
        content: `${commit.message.split('\n')[0]}\nFiles: ${commit.files.join(', ')}`,
        project,
        actor: commit.author,
        sourceRef: commit.hash,
        metadata: {
          commitHash: commit.hash,
          files: commit.files,
        },
      });
    }

    const extraction = await this.extractor.extractFromCommit(commit, project);
    if (!extraction.extracted || !extraction.input) {
      return {
        status: 'skipped',
        reason: extraction.reason,
      };
    }

    const input = {
      ...extraction.input,
      source: options.captureSource ?? extraction.input.source ?? CaptureSource.CLI,
      context: {
        ...(extraction.input.context ?? {}),
        project,
        filePaths: commit.files,
      },
    };

    if (dryRun) {
      return {
        status: 'imported',
        reason: 'Preview only',
        preview: input,
      };
    }

    const result = await this.sink.addKnowledge(input);
    return {
      status: result.success ? 'imported' : 'skipped',
      reason: result.message ?? 'Commit processed',
      view: result.view,
    };
  }

  private async routeMindstrateInput(input: RepoScannerMindstrateInput): Promise<void> {
    if (input.type === 'event') {
      this.memory.events.ingestEvent(input.event);
      return;
    }
    if (input.type === 'bundle') {
      this.memory.bundles.installBundle(input.bundle);
      return;
    }
    this.memory.context.ingestProjectGraphChangeSet({
      name: input.project,
      root: process.cwd(),
      dependencies: [],
      entryPoints: [],
      truncatedDeps: 0,
      scripts: {},
      topDirs: [],
      detectedAt: new Date().toISOString(),
    }, input.changeSet);
  }

  private async executeGitLocalSource(source: ScanSource, runId: string): Promise<ScanExecutionResult> {
    const repoPath = ensureGitClone(source);
    const head = getHeadCommit(repoPath, source.branch);

    if (!source.lastCursor) {
      await this.initializeProjectFromPath(source, repoPath, runId);
      if (source.initMode === 'from_now') {
        return {
          sourceId: source.id,
          mode: 'initialized',
          itemsSeen: 0,
          itemsImported: 0,
          itemsSkipped: 0,
          itemsFailed: 0,
          cursor: head,
        };
      }

      const initialCommits = listRecentCommits(repoPath, source.backfillCount, source.branch);
      const processed = await this.processCommits(source, repoPath, initialCommits, runId);
      return {
        sourceId: source.id,
        mode: 'initialized',
        ...processed,
        cursor: initialCommits.at(-1) ?? head,
      };
    }

    const commits = listCommitsSince(repoPath, source.lastCursor, source.branch);
    const processed = await this.processCommits(source, repoPath, commits, runId);
    return {
      sourceId: source.id,
      mode: 'incremental',
      ...processed,
      cursor: commits.at(-1) ?? source.lastCursor,
    };
  }

  private async initializeP4Project(source: ScanSource, env: P4Env | undefined, runId: string): Promise<void> {
    const projectRoot = source.repoPath ?? findP4WorkspaceRoot(source.depotPath, env);
    if (!projectRoot) {
      throw new Error(`P4 source ${source.id} needs a local workspace path for first-run project initialization`);
    }
    await this.initializeProjectFromPath(source, projectRoot, runId);
  }

  private async initializeProjectFromPath(source: ScanSource, root: string, runId: string): Promise<void> {
    const detected = detectProject(root);
    if (!detected) return;
    const project: DetectedProject = {
      ...detected,
      name: source.project,
      root,
    };
    await this.memory.snapshots.upsertProjectSnapshot(project, { author: 'repo-scanner' });
    this.memory.context.indexProjectGraph(project, {
      onScanProgress: this.createInitProgressReporter(runId),
    });
  }

  /**
   * First-run graph indexing on a large checkout runs for minutes before a
   * single commit is processed, leaving the run row frozen at zero. Write
   * the scanned file count into the run as a throttled heartbeat so the UI
   * "running" state shows movement; the final commit-based stats overwrite
   * these numbers when the run finishes.
   */
  private createInitProgressReporter(runId: string): (event: ProjectGraphScanProgress) => void {
    let lastWriteMs = 0;
    return (event) => {
      const now = Date.now();
      if (now - lastWriteMs < 500) return;
      lastWriteMs = now;
      this.scanner.updateRunProgress(runId, {
        itemsSeen: event.files,
        itemsImported: 0,
        itemsSkipped: 0,
        itemsFailed: 0,
      });
    };
  }

  private async executeP4Source(source: ScanSource, runId: string): Promise<ScanExecutionResult> {
    const depot = source.depotPath;
    const env = p4EnvOf(source);

    if (!source.lastCursor) {
      await this.initializeP4Project(source, env, runId);
      if (source.initMode === 'from_now') {
        const latest = getRecentChangelists(1, depot, env);
        return {
          sourceId: source.id,
          mode: 'initialized',
          itemsSeen: 0,
          itemsImported: 0,
          itemsSkipped: 0,
          itemsFailed: 0,
          cursor: latest[0],
        };
      }

      // backfill_recent — getRecentChangelists returns newest-first; reverse to chronological.
      const recent = getRecentChangelists(source.backfillCount, depot, env).slice().reverse();
      const processed = await this.processChangelists(source, recent, runId);
      return {
        sourceId: source.id,
        mode: 'initialized',
        ...processed,
        cursor: recent.at(-1),
      };
    }

    const cls = listChangelistsSince(source.lastCursor, depot, env);
    const processed = await this.processChangelists(source, cls, runId);
    return {
      sourceId: source.id,
      mode: 'incremental',
      ...processed,
      cursor: cls.at(-1) ?? source.lastCursor,
    };
  }

  private async processChangelists(
    source: ScanSource,
    changelists: string[],
    runId: string,
  ): Promise<Pick<ScanExecutionResult, 'itemsSeen' | 'itemsImported' | 'itemsSkipped' | 'itemsFailed'>> {
    let itemsImported = 0;
    let itemsSkipped = 0;
    let itemsFailed = 0;
    const env = p4EnvOf(source);

    for (const [index, cl] of changelists.entries()) {
      const externalId = `p4@${cl}`;
      try {
        const commit = getChangelistInfo(cl, env);
        if (!commit) {
          itemsFailed++;
          this.scanner.recordFailedItem(source.id, externalId, 'changelist could not be read');
          continue;
        }

        const outcome = await this.processCommit(source, commit);
        if (outcome === 'imported') {
          itemsImported++;
        } else if (outcome === 'skipped') {
          itemsSkipped++;
        } else {
          itemsFailed++;
          this.scanner.recordFailedItem(source.id, externalId, 'changelist processing failed');
        }
      } catch (error) {
        itemsFailed++;
        this.scanner.recordFailedItem(source.id, externalId, errorMessage(error));
      }
      this.scanner.updateRunProgress(runId, {
        itemsSeen: index + 1,
        itemsImported,
        itemsSkipped,
        itemsFailed,
      });
    }

    return {
      itemsSeen: changelists.length,
      itemsImported,
      itemsSkipped,
      itemsFailed,
    };
  }

  private async processCommits(
    source: ScanSource,
    repoPath: string,
    commits: string[],
    runId: string,
  ): Promise<Pick<ScanExecutionResult, 'itemsSeen' | 'itemsImported' | 'itemsSkipped' | 'itemsFailed'>> {
    let itemsImported = 0;
    let itemsSkipped = 0;
    let itemsFailed = 0;

    for (const [index, hash] of commits.entries()) {
      try {
        const commit = readCommit(repoPath, hash);
        if (!commit) {
          itemsFailed++;
          this.scanner.recordFailedItem(source.id, hash, 'commit could not be read');
          continue;
        }

        const outcome = await this.processCommit(source, commit);
        if (outcome === 'imported') {
          itemsImported++;
        } else if (outcome === 'skipped') {
          itemsSkipped++;
        } else {
          itemsFailed++;
          this.scanner.recordFailedItem(source.id, hash, 'commit processing failed');
        }
      } catch (error) {
        itemsFailed++;
        this.scanner.recordFailedItem(
          source.id,
          hash,
          errorMessage(error),
        );
      }
      this.scanner.updateRunProgress(runId, {
        itemsSeen: index + 1,
        itemsImported,
        itemsSkipped,
        itemsFailed,
      });
    }

    return {
      itemsSeen: commits.length,
      itemsImported,
      itemsSkipped,
      itemsFailed,
    };
  }

  private async processCommit(source: ScanSource, commit: { hash: string; files: string[]; message: string; diff: string; author: string }) {
    const result = await this.ingestCommit({
      project: source.project,
      commit: commit as CommitInfo,
      captureSource: source.kind === 'p4' ? CaptureSource.P4_TRIGGER : CaptureSource.GIT_HOOK,
      dryRun: false,
    });
    this.markProjectGraphChanges(source, commit);
    return result.status;
  }

  /**
   * The project graph is only rebuilt from the local checkout, which stays
   * at whatever revision the operator last synced — every ingested upstream
   * change therefore stamps staleness markers on the affected graph nodes
   * so impact analysis can flag possibly-outdated conclusions until the
   * next reindex. Best-effort: a marker failure must not fail ingestion.
   */
  private markProjectGraphChanges(
    source: ScanSource,
    commit: { hash: string; files: string[] },
  ): void {
    if (commit.files.length === 0) return;
    try {
      this.memory.context.recordProjectGraphExternalChanges({
        project: source.project,
        source: source.kind === 'p4' ? ChangeSource.P4 : ChangeSource.GIT,
        files: commit.files,
        externalRef: commit.hash,
      });
    } catch {
      // Knowledge ingestion already succeeded; losing one staleness marker
      // only means the graph looks slightly fresher than it is.
    }
  }
}

function p4EnvOf(source: ScanSource): P4Env | undefined {
  if (!source.p4Port && !source.p4User && !source.p4Passwd) return undefined;
  return {
    p4Port: source.p4Port,
    p4User: source.p4User,
    p4Passwd: source.p4Passwd,
  };
}
