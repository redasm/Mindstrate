export type ScanSourceKind = 'git-local' | 'p4';
export type ScanInitMode = 'from_now' | 'backfill_recent';
export type ScanRunStatus = 'running' | 'completed' | 'failed';

export interface GitLocalSourceInput {
  name: string;
  project: string;
  repoPath: string;
  branch?: string;
  remoteUrl?: string;
  authToken?: string;
  intervalSec?: number;
  initMode?: ScanInitMode;
  backfillCount?: number;
  enabled?: boolean;
}

export interface P4SourceInput {
  name: string;
  project: string;
  depotPath?: string;
  p4Port?: string;
  p4User?: string;
  p4Passwd?: string;
  intervalSec?: number;
  initMode?: ScanInitMode;
  backfillCount?: number;
  enabled?: boolean;
}

export interface UpdateScanSourceInput {
  name?: string;
  project?: string;
  enabled?: boolean;
  repoPath?: string;
  depotPath?: string;
  branch?: string;
  remoteUrl?: string | null;
  authToken?: string | null;
  p4Port?: string | null;
  p4User?: string | null;
  p4Passwd?: string | null;
  intervalSec?: number;
  initMode?: ScanInitMode;
  backfillCount?: number;
}

export interface ScanSource {
  id: string;
  kind: ScanSourceKind;
  name: string;
  project: string;
  enabled: boolean;
  repoPath?: string;
  depotPath?: string;
  branch?: string;
  remoteUrl?: string;
  authToken?: string;
  p4Port?: string;
  p4User?: string;
  p4Passwd?: string;
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
