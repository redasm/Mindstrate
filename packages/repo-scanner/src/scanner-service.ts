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
  type ProjectGraphIndexProgress,
  type ScanLogLevel,
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

/** Hard cap on persisted log rows per source; older lines are pruned at each run start. */
const SCAN_LOG_MAX_ROWS = 500;

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

  /**
   * Append a line to the source's persisted scan log (visible in the web UI)
   * and mirror it to the daemon's stdout. Logging must never break a scan, so
   * a persistence failure is swallowed.
   */
  private log(
    sourceId: string,
    runId: string | null,
    level: ScanLogLevel,
    message: string,
    phase?: string,
  ): void {
    try {
      this.scanner.appendLog({ sourceId, runId, level, phase, message });
    } catch {
      // never let logging abort a scan
    }
    const prefix = `[repo-scanner${phase ? `:${phase}` : ''}]`;
    if (level === 'error') console.error(`${prefix} ${message}`);
    else if (level === 'warn') console.warn(`${prefix} ${message}`);
    else console.log(`${prefix} ${message}`);
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
    this.scanner.pruneLogs(sourceId, SCAN_LOG_MAX_ROWS);
    this.log(
      sourceId,
      run.id,
      'info',
      `Scan started for "${source.name}" — ${source.kind}, project "${source.project}", `
        + `${source.lastCursor ? 'incremental' : `first run (init mode: ${source.initMode})`}`,
      'start',
    );

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
      this.log(
        sourceId,
        run.id,
        'info',
        `Scan completed (${result.mode}): ${result.itemsImported}/${result.itemsSeen} imported, `
          + `${result.itemsSkipped} skipped, ${result.itemsFailed} failed`,
        'done',
      );
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
      this.log(sourceId, run.id, 'error', `Scan failed: ${message}`, 'done');
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
        this.log(
          source.id,
          runId,
          'info',
          'Init mode "from_now": project graph built; no historical commits imported. '
            + 'New commits will be imported on subsequent scans.',
          'init',
        );
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
      this.log(source.id, runId, 'info', `Backfilling ${initialCommits.length} recent commit(s)`, 'backfill');
      const processed = await this.processCommits(source, repoPath, initialCommits, runId);
      return {
        sourceId: source.id,
        mode: 'initialized',
        ...processed,
        cursor: initialCommits.at(-1) ?? head,
      };
    }

    const commits = listCommitsSince(repoPath, source.lastCursor, source.branch);
    this.log(source.id, runId, 'info', `Incremental scan: ${commits.length} new commit(s) since last cursor`, 'incremental');
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
    if (!detected) {
      this.log(
        source.id,
        runId,
        'warn',
        `Project detection found nothing at ${root}; skipping project graph index`,
        'init',
      );
      return;
    }
    const project: DetectedProject = {
      ...detected,
      name: source.project,
      root,
    };
    if (!detected.detectionRule) {
      // No rule matched (neither the project's .mindstrate/rules nor the
      // built-in ones) → detectGenericProject ran, so there are no
      // ignore/sourceRoots/generatedRoots hints and the whole directory gets
      // indexed with built-in ignores only. The usual cause: the scan root is a
      // subdirectory missing the markers a rule needs (e.g. the built-in Unreal
      // rule needs a *.uproject at the scan root), so even the bundled rules
      // can't match. Make it loud instead of silently bare-scanning.
      this.log(
        source.id,
        runId,
        'warn',
        `No project detection rule matched under ${root} — indexing the entire directory `
          + 'with built-in ignores only (generated dirs like TypeScript/Typing will NOT be '
          + 'excluded). Built-in rules need a marker at the scan root (e.g. a *.uproject file '
          + 'for Unreal). Point the source at the directory that has it, or add a '
          + '.mindstrate/rules folder here, then re-scan.',
        'init',
      );
    }
    await this.memory.snapshots.upsertProjectSnapshot(project, { author: 'repo-scanner' });
    this.log(source.id, runId, 'info', `Indexing project graph under ${root} (large checkouts can take a while)`, 'index');
    const indexResult = this.memory.context.indexProjectGraph(project, {
      onScanProgress: this.createInitProgressReporter(source.id, runId),
      onIndexProgress: this.createIndexPhaseReporter(source.id, runId),
    });
    this.log(
      source.id,
      runId,
      'info',
      `Project graph indexed: ${indexResult.filesScanned} files scanned, ${indexResult.skippedFiles} skipped`,
      'index',
    );
    await this.enrichProjectGraph(source, project, runId);
  }

  /**
   * Mirror the local `mindstrate init` flow: after deterministic indexing,
   * run LLM enrichment with the project's provider config (Settings → LLM
   * Configs). Unconfigured projects come back as status `skipped`, and an
   * enrichment failure must not fail first-run initialization — the
   * deterministic graph is already written by then.
   */
  private async enrichProjectGraph(source: ScanSource, project: DetectedProject, runId: string): Promise<void> {
    try {
      const result = await this.memory.context.enrichProjectGraph(project);
      const reason = 'reason' in result && result.reason ? ` (${result.reason})` : '';
      const level: ScanLogLevel = result.status === 'skipped' ? 'warn' : 'info';
      this.log(
        source.id,
        runId,
        level,
        `Graph LLM enrichment for "${project.name}": ${result.status}${reason}, nodes=${result.nodesCreated}`,
        'enrich',
      );
    } catch (error) {
      this.log(
        source.id,
        runId,
        'error',
        `Graph LLM enrichment for "${project.name}" failed: ${errorMessage(error)}`,
        'enrich',
      );
    }
  }

  /**
   * First-run graph indexing on a large checkout runs for minutes before a
   * single commit is processed, leaving the run row frozen at zero. Write
   * the scanned file count into the run as a throttled heartbeat so the UI
   * "running" state shows movement; the final commit-based stats overwrite
   * these numbers when the run finishes. A coarser throttle also drops a log
   * line so the persisted scan log shows index progress (and how far it got
   * if the process dies mid-index).
   */
  private createInitProgressReporter(sourceId: string, runId: string): (event: ProjectGraphScanProgress) => void {
    let lastWriteMs = 0;
    let lastLogMs = 0;
    return (event) => {
      const now = Date.now();
      if (now - lastLogMs >= 5000) {
        lastLogMs = now;
        this.log(
          sourceId,
          runId,
          'info',
          `Indexing… ${event.files} files scanned, ${event.skippedFiles} skipped`,
          'index',
        );
      }
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

  /**
   * The post-scan parse phase (tree-sitter parsing, fact extraction, graph
   * write) can run for many minutes on a large source tree while emitting
   * nothing — scan heartbeats have stopped and `items_seen` would otherwise
   * freeze, so the run looks hung. Mirror the scan heartbeat for the parse
   * phases: a throttled log line plus a run-progress write keep the UI and
   * the persisted log moving (and show how far parsing got if it dies).
   */
  private createIndexPhaseReporter(sourceId: string, runId: string): (event: ProjectGraphIndexProgress) => void {
    let lastLogMs = 0;
    let lastWriteMs = 0;
    return (event) => {
      const now = Date.now();
      if (now - lastLogMs >= 5000) {
        lastLogMs = now;
        this.log(
          sourceId,
          runId,
          'info',
          `Parsing (${event.phase})… ${event.filesProcessed}/${event.filesTotal} files, ${event.nodes} nodes`,
          'index',
        );
      }
      if (now - lastWriteMs < 500) return;
      lastWriteMs = now;
      this.scanner.updateRunProgress(runId, {
        itemsSeen: event.filesProcessed,
        itemsImported: 0,
        itemsSkipped: event.skippedFiles,
        itemsFailed: 0,
      });
    };
  }

  /**
   * True when the project graph already has nodes for this project — i.e. a
   * previous run indexed it. Lets a cursor-less retry (e.g. after a P4 outage
   * blocked cursor setup) skip the expensive re-index.
   */
  private projectGraphExists(project: string): boolean {
    return this.memory.maintenance.getProjectBreakdown().some(
      (entry) => entry.project === project && entry.entries > 0,
    );
  }

  private async executeP4Source(source: ScanSource, runId: string): Promise<ScanExecutionResult> {
    const depot = source.depotPath;
    const env = p4EnvOf(source);

    if (!source.lastCursor) {
      if (this.projectGraphExists(source.project)) {
        this.log(
          source.id,
          runId,
          'info',
          'Project graph already indexed by a previous run; skipping re-index and (re)establishing the P4 cursor.',
          'init',
        );
      } else {
        await this.initializeP4Project(source, env, runId);
      }

      // The deterministic project graph is indexed and persisted by this point.
      // Everything below needs the P4 server. If it is unreachable, don't throw
      // the index away as a failed run — finish as "initialized" without a
      // cursor so the next scan retries the cursor/backfill (and won't re-index,
      // thanks to the guard above).
      try {
        if (source.initMode === 'from_now') {
          const latest = getRecentChangelists(1, depot, env);
          this.log(
            source.id,
            runId,
            'info',
            'Init mode "from_now": project graph built; no historical changelists imported. '
              + 'New changelists will be imported on subsequent scans.',
            'init',
          );
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
        this.log(source.id, runId, 'info', `Backfilling ${recent.length} recent changelist(s)`, 'backfill');
        const processed = await this.processChangelists(source, recent, runId);
        return {
          sourceId: source.id,
          mode: 'initialized',
          ...processed,
          cursor: recent.at(-1),
        };
      } catch (error) {
        this.log(
          source.id,
          runId,
          'warn',
          `Project graph indexed, but P4 changelist access failed (${errorMessage(error)}); `
            + 'cursor not set — will retry on the next scan.',
          'init',
        );
        return {
          sourceId: source.id,
          mode: 'initialized',
          itemsSeen: 0,
          itemsImported: 0,
          itemsSkipped: 0,
          itemsFailed: 0,
        };
      }
    }

    const cls = listChangelistsSince(source.lastCursor, depot, env);
    this.log(source.id, runId, 'info', `Incremental scan: ${cls.length} new changelist(s) since last cursor`, 'incremental');
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
