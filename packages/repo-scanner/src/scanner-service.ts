import {
  CaptureSource,
  errorMessage,
  Mindstrate,
  KnowledgeExtractor,
  loadConfig,
  type CommitInfo,
} from '@mindstrate/server';
import { getHeadCommit, listCommitsSince, listRecentCommits, readCommit } from './git-scanner.js';
import { createKnowledgeSink, defaultScannerDbPath, type KnowledgeSink } from './knowledge-sink.js';
import { SourceStore } from './source-store.js';
import type { CommitIngestionOptions, CommitIngestionResult, GitLocalSourceInput, ScanExecutionResult, ScanSource } from './types.js';

export interface RepoScannerOptions {
  scannerDbPath?: string;
  memory?: Mindstrate;
}

export class RepoScannerService {
  readonly store: SourceStore;
  private sink: KnowledgeSink;
  private extractor: KnowledgeExtractor;

  constructor(options: RepoScannerOptions = {}) {
    const scannerDbPath = options.scannerDbPath ?? defaultScannerDbPath();
    this.store = new SourceStore(scannerDbPath);
    const config = loadConfig(options.memory?.getConfig());
    this.sink = createKnowledgeSink(options.memory);
    this.extractor = new KnowledgeExtractor(
      config.openaiApiKey,
      config.llmModel,
      config.openaiBaseUrl,
    );
  }

  async init(): Promise<void> {
    await this.sink.init();
  }

  addGitLocalSource(input: GitLocalSourceInput): ScanSource {
    return this.store.createGitLocalSource(input);
  }

  listSources(): ScanSource[] {
    return this.store.listSources();
  }

  enableSource(sourceId: string): void {
    this.store.setSourceEnabled(sourceId, true);
  }

  disableSource(sourceId: string): void {
    this.store.setSourceEnabled(sourceId, false);
  }

  listRuns(sourceId: string) {
    return this.store.listRuns(sourceId);
  }

  listFailedItems(sourceId: string) {
    return this.store.listFailedItems(sourceId);
  }

  getSourceStatus(sourceId: string) {
    const source = this.store.getSource(sourceId);
    if (!source) {
      throw new Error(`Unknown source: ${sourceId}`);
    }

    return {
      source,
      recentRuns: this.store.listRuns(sourceId),
      failedItems: this.store.listFailedItems(sourceId),
    };
  }

  async runSource(sourceId: string): Promise<ScanExecutionResult> {
    const source = this.store.getSource(sourceId);
    if (!source) {
      throw new Error(`Unknown source: ${sourceId}`);
    }
    if (!source.enabled) {
      throw new Error(`Source is disabled: ${sourceId}`);
    }
    if (this.store.hasRunningRun(sourceId)) {
      throw new Error(`Source is already running: ${sourceId}`);
    }

    this.store.markRunStart(sourceId);
    const run = this.store.createRun(sourceId);

    try {
      const result = await this.executeGitLocalSource(source);
      this.store.finishRun(run.id, 'completed', {
        itemsSeen: result.itemsSeen,
        itemsImported: result.itemsImported,
        itemsSkipped: result.itemsSkipped,
        itemsFailed: result.itemsFailed,
      });
      if (result.cursor) {
        this.store.updateCursor(sourceId, result.cursor);
      }
      return result;
    } catch (error) {
      const message = errorMessage(error);
      this.store.markError(sourceId, message);
      this.store.finishRun(run.id, 'failed', {
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
    const source = this.store.getSource(sourceId);
    if (!source) throw new Error(`Unknown source: ${sourceId}`);

    const failedItems = this.store.listFailedItems(sourceId);
    let itemsImported = 0;
    let itemsSkipped = 0;
    let itemsFailed = 0;

    for (const failed of failedItems) {
      try {
        const commit = readCommit(source.repoPath, failed.externalId);
        if (!commit) {
          itemsFailed++;
          this.store.recordFailedItem(source.id, failed.externalId, 'commit no longer readable');
          continue;
        }
        const imported = await this.processCommit(source, commit);
        if (imported === 'imported') {
          itemsImported++;
          this.store.deleteFailedItem(failed.id);
        } else if (imported === 'skipped') {
          itemsSkipped++;
          this.store.deleteFailedItem(failed.id);
        } else {
          itemsFailed++;
          this.store.recordFailedItem(source.id, failed.externalId, 'retry failed');
        }
      } catch (error) {
        itemsFailed++;
        this.store.recordFailedItem(
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

  async close(): Promise<void> {
    this.store.close();
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

    const extraction = await this.extractor.extractFromCommit(commit);
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

  private async executeGitLocalSource(source: ScanSource): Promise<ScanExecutionResult> {
    const head = getHeadCommit(source.repoPath, source.branch);

    if (!source.lastCursor) {
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

      const initialCommits = listRecentCommits(source.repoPath, source.backfillCount, source.branch);
      const processed = await this.processCommits(source, initialCommits);
      return {
        sourceId: source.id,
        mode: 'initialized',
        ...processed,
        cursor: initialCommits.at(-1) ?? head,
      };
    }

    const commits = listCommitsSince(source.repoPath, source.lastCursor, source.branch);
    const processed = await this.processCommits(source, commits);
    return {
      sourceId: source.id,
      mode: 'incremental',
      ...processed,
      cursor: commits.at(-1) ?? source.lastCursor,
    };
  }

  private async processCommits(
    source: ScanSource,
    commits: string[],
  ): Promise<Pick<ScanExecutionResult, 'itemsSeen' | 'itemsImported' | 'itemsSkipped' | 'itemsFailed'>> {
    let itemsImported = 0;
    let itemsSkipped = 0;
    let itemsFailed = 0;

    for (const hash of commits) {
      try {
        const commit = readCommit(source.repoPath, hash);
        if (!commit) {
          itemsFailed++;
          this.store.recordFailedItem(source.id, hash, 'commit could not be read');
          continue;
        }

        const outcome = await this.processCommit(source, commit);
        if (outcome === 'imported') {
          itemsImported++;
        } else if (outcome === 'skipped') {
          itemsSkipped++;
        } else {
          itemsFailed++;
          this.store.recordFailedItem(source.id, hash, 'commit processing failed');
        }
      } catch (error) {
        itemsFailed++;
        this.store.recordFailedItem(
          source.id,
          hash,
          errorMessage(error),
        );
      }
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
      captureSource: CaptureSource.GIT_HOOK,
      dryRun: false,
    });
    return result.status;
  }
}
