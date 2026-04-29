import type {
  CaptureSource,
  ChangeSet,
  CommitInfo,
  CreateKnowledgeInput,
  GraphKnowledgeView,
  IngestContextEventInput,
  PortableContextBundle,
} from '@mindstrate/server';

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

export interface CommitIngestionOptions {
  project: string;
  commit: CommitInfo;
  captureSource?: CaptureSource;
  recordGitActivity?: boolean;
  dryRun?: boolean;
}

export interface CommitIngestionResult {
  status: 'imported' | 'skipped';
  reason: string;
  preview?: CreateKnowledgeInput;
  view?: GraphKnowledgeView;
}

export type RepoScannerMindstrateInput =
  | {
    type: 'event';
    event: IngestContextEventInput;
  }
  | {
    type: 'changeset';
    project: string;
    changeSet: ChangeSet;
  }
  | {
    type: 'bundle';
    bundle: PortableContextBundle;
  };

export interface RepoScannerSourceDiscoveryInput {
  sourceId: string;
  cursor?: string;
}

export interface RepoScannerSourceDiscoveryResult<TItem> {
  cursor?: string;
  items: TItem[];
}

export interface RepoScannerSourceAdapter<TItem = unknown> {
  id: string;
  kind: string;
  discover(input: RepoScannerSourceDiscoveryInput): Promise<RepoScannerSourceDiscoveryResult<TItem>>;
  toMindstrateInput(item: TItem): Promise<RepoScannerMindstrateInput>;
}
