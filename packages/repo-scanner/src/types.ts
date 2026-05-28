import type {
  CaptureSource,
  ChangeSet,
  CommitInfo,
  CreateKnowledgeInput,
  GraphKnowledgeView,
  IngestContextEventInput,
  PortableContextBundle,
} from '@mindstrate/server';

export type {
  FailedScanItem,
  GitLocalSourceInput,
  P4SourceInput,
  ScanInitMode,
  ScanRun,
  ScanRunStatus,
  ScanSource,
  ScanSourceKind,
  UpdateScanSourceInput,
} from '@mindstrate/server';

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
