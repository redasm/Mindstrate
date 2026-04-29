export enum ProjectGraphNodeKind {
  PROJECT = 'project',
  DIRECTORY = 'directory',
  FILE = 'file',
  MODULE = 'module',
  COMPONENT = 'component',
  ROUTE = 'route',
  CONFIG = 'config',
  SCRIPT = 'script',
  DEPENDENCY = 'dependency',
  FUNCTION = 'function',
  CLASS = 'class',
  TYPE = 'type',
  CONCEPT = 'concept',
  DECISION = 'decision',
  CONSTRAINT = 'constraint',
  RISK = 'risk',
}

export enum ProjectGraphEdgeKind {
  CONTAINS = 'contains',
  IMPORTS = 'imports',
  EXPORTS = 'exports',
  DEPENDS_ON = 'depends_on',
  DEFINES = 'defines',
  CONFIGURES = 'configures',
  ROUTES_TO = 'routes_to',
  RENDERS = 'renders',
  CALLS = 'calls',
  USES_HOOK = 'uses_hook',
  DOCUMENTS = 'documents',
  CONSTRAINS = 'constrains',
  RATIONALE_FOR = 'rationale_for',
  RELATED_TO = 'related_to',
}

export enum ProjectGraphProvenance {
  EXTRACTED = 'EXTRACTED',
  INFERRED = 'INFERRED',
  AMBIGUOUS = 'AMBIGUOUS',
}

export enum ChangeSource {
  GIT = 'git',
  P4 = 'p4',
  FILESYSTEM = 'filesystem',
  MANUAL = 'manual',
}

export enum ProjectGraphOverlayKind {
  NOTE = 'note',
  CONFIRMATION = 'confirmation',
  CORRECTION = 'correction',
  REJECTION = 'rejection',
  RISK = 'risk',
  CONVENTION = 'convention',
}

export enum ProjectGraphOverlaySource {
  OBSIDIAN = 'obsidian',
  WEB = 'web',
  MCP = 'mcp',
  CLI = 'cli',
}

export interface ProjectGraphOverlay {
  id: string;
  project: string;
  targetNodeId?: string;
  targetEdgeId?: string;
  kind: ProjectGraphOverlayKind;
  content: string;
  author?: string;
  source: ProjectGraphOverlaySource;
  createdAt: string;
  updatedAt: string;
}

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'moved';

export interface EvidenceRef {
  path: string;
  startLine?: number;
  endLine?: number;
  extractorId: string;
  captureName?: string;
}

export interface ProjectGraphNodeDto {
  id: string;
  kind: ProjectGraphNodeKind;
  label: string;
  project: string;
  provenance: ProjectGraphProvenance;
  evidence: EvidenceRef[];
  metadata?: Record<string, unknown>;
}

export interface ProjectGraphEdgeDto {
  id: string;
  sourceId: string;
  targetId: string;
  kind: ProjectGraphEdgeKind;
  provenance: ProjectGraphProvenance;
  evidence: EvidenceRef[];
  metadata?: Record<string, unknown>;
}

export interface ProjectLayer {
  id: string;
  label: string;
  roots: string[];
  language?: string;
  parserAdapters: string[];
  queryPacks?: string[];
  conventionExtractors?: string[];
  changeAdapters?: ChangeSource[];
  generated?: boolean;
}

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  oldPath?: string;
  language?: string;
  layerId?: string;
}

export interface ChangeSet {
  source: ChangeSource;
  base?: string;
  head?: string;
  files: ChangedFile[];
}
