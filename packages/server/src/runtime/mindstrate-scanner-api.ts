import type {
  FailedScanItem,
  GitLocalSourceInput,
  P4SourceInput,
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
}
