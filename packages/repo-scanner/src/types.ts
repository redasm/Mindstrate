export type ScanSourceKind = 'git-local';
export type ScanInitMode = 'from_now' | 'backfill_recent';

export interface GitLocalSourceInput {
  name: string;
  project: string;
  repoPath: string;
  branch?: string;
  intervalSec?: number;
  initMode?: ScanInitMode;
  backfillCount?: number;
  enabled?: boolean;
}

export interface ScanSource {
  id: string;
  kind: ScanSourceKind;
  name: string;
  project: string;
  enabled: boolean;
  repoPath: string;
  branch?: string;
  intervalSec: number;
  initMode: ScanInitMode;
  backfillCount: number;
  lastCursor?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export type ScanRunStatus = 'running' | 'completed' | 'failed';

export interface ScanRun {
  id: string;
  sourceId: string;
  status: ScanRunStatus;
  startedAt: string;
  finishedAt?: string;
  itemsSeen: number;
  itemsImported: number;
  itemsSkipped: number;
  itemsFailed: number;
  error?: string;
}

export interface FailedScanItem {
  id: string;
  sourceId: string;
  externalId: string;
  error: string;
  firstSeenAt: string;
  lastTriedAt: string;
  retryCount: number;
}

export interface ScanExecutionResult {
  sourceId: string;
  mode: 'initialized' | 'incremental';
  itemsSeen: number;
  itemsImported: number;
  itemsSkipped: number;
  itemsFailed: number;
  cursor?: string;
}
