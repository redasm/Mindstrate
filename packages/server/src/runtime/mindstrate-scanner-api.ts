import type {
  AppendScanLogInput,
  FailedScanItem,
  GitLocalSourceInput,
  P4SourceInput,
  ScanLog,
  ScanRun,
  ScanRunStatus,
  ScanSource,
  UpdateScanSourceInput,
} from '@mindstrate/protocol';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateScannerApi {
  constructor(private readonly services: MindstrateRuntime) {}

  createGitLocalSource(input: GitLocalSourceInput): ScanSource {
    return this.services.scanSourceRepository.createGitLocalSource(input);
  }

  createP4Source(input: P4SourceInput): ScanSource {
    return this.services.scanSourceRepository.createP4Source(input);
  }

  listSources(): ScanSource[] {
    return this.services.scanSourceRepository.listSources();
  }

  getSource(id: string): ScanSource | null {
    return this.services.scanSourceRepository.getSource(id);
  }

  setSourceEnabled(id: string, enabled: boolean): void {
    this.services.scanSourceRepository.setSourceEnabled(id, enabled);
  }

  updateSource(id: string, patch: UpdateScanSourceInput): ScanSource | null {
    return this.services.scanSourceRepository.updateSource(id, patch);
  }

  deleteSource(id: string): boolean {
    return this.services.scanSourceRepository.deleteSource(id);
  }

  /**
   * Queue a from-scratch re-scan of a source without deleting/recreating it.
   *
   * Always clears the project's existing scanner-extracted graph nodes, then
   * resets the cursor so the next daemon tick treats it as a first run (full
   * re-index). Wiping first is required, not optional: a plain re-index upserts
   * by stable id but never removes nodes for files deleted since the last scan,
   * and the P4 path skips re-indexing entirely while any project-graph node
   * still exists. Manually-authored knowledge / snapshots are always preserved
   * (only nodes tagged `metadata.projectGraph` are removed). Returns null if
   * the source does not exist.
   */
  rescanFromScratch(
    id: string,
  ): { sourceId: string; project: string; graphNodesDeleted: number } | null {
    const source = this.services.scanSourceRepository.getSource(id);
    if (!source) return null;
    const graphNodesDeleted = this.services.contextGraphStore.deleteProjectGraphNodes(source.project).nodesDeleted;
    this.services.scanSourceRepository.resetCursor(id);
    return { sourceId: id, project: source.project, graphNodesDeleted };
  }

  resetCursor(id: string): boolean {
    return this.services.scanSourceRepository.resetCursor(id);
  }

  listDueSources(now: Date = new Date()): ScanSource[] {
    return this.services.scanSourceRepository.listDueSources(now);
  }

  updateCursor(id: string, cursor: string): void {
    this.services.scanSourceRepository.updateCursor(id, cursor);
  }

  markRunStart(id: string): void {
    this.services.scanSourceRepository.markRunStart(id);
  }

  markError(id: string, error: string): void {
    this.services.scanSourceRepository.markError(id, error);
  }

  hasRunningRun(sourceId: string): boolean {
    return this.services.scanSourceRepository.hasRunningRun(sourceId);
  }

  /** See ScanSourceRepository.recoverOrphanedRuns — daemon-startup only. */
  recoverOrphanedRuns(): number {
    return this.services.scanSourceRepository.recoverOrphanedRuns();
  }

  createRun(sourceId: string): ScanRun {
    return this.services.scanSourceRepository.createRun(sourceId);
  }

  finishRun(
    id: string,
    status: ScanRunStatus,
    stats: { itemsSeen: number; itemsImported: number; itemsSkipped: number; itemsFailed: number; error?: string },
  ): void {
    this.services.scanSourceRepository.finishRun(id, status, stats);
  }

  updateRunProgress(
    id: string,
    stats: { itemsSeen: number; itemsImported: number; itemsSkipped: number; itemsFailed: number },
  ): void {
    this.services.scanSourceRepository.updateRunProgress(id, stats);
  }

  listRuns(sourceId: string): ScanRun[] {
    return this.services.scanSourceRepository.listRuns(sourceId);
  }

  recordFailedItem(sourceId: string, externalId: string, error: string): void {
    this.services.scanSourceRepository.recordFailedItem(sourceId, externalId, error);
  }

  listFailedItems(sourceId: string): FailedScanItem[] {
    return this.services.scanSourceRepository.listFailedItems(sourceId);
  }

  deleteFailedItem(id: string): void {
    this.services.scanSourceRepository.deleteFailedItem(id);
  }

  appendLog(input: AppendScanLogInput): ScanLog {
    return this.services.scanSourceRepository.appendLog(input);
  }

  listLogs(sourceId: string, limit?: number): ScanLog[] {
    return this.services.scanSourceRepository.listLogs(sourceId, limit);
  }

  pruneLogs(sourceId: string, keep: number): void {
    this.services.scanSourceRepository.pruneLogs(sourceId, keep);
  }
}
