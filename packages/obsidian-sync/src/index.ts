/**
 * @mindstrate/obsidian-sync
 *
 * Bidirectional sync between Mindstrate and an Obsidian vault.
 */

export {
  serializeGraphKnowledge,
  parseMarkdown,
  parsedToCreate,
  parsedToUpdate,
  computeBodyHash,
  extractBody,
  getVaultSyncMode,
  type ParsedMarkdown,
  type MarkdownFrontmatter,
  type VaultSyncMode,
} from './markdown.js';

export {
  VaultLayout,
  extractIdSuffixFromFilename,
  idMatchesSuffix,
  GLOBAL_PROJECT_FOLDER,
  META_FOLDER,
  INDEX_FILE,
  type VaultLayoutOptions,
  type VaultIndex,
} from './vault-layout.js';

export {
  VaultExporter,
  type ExportResult,
  type VaultExporterOptions,
} from './exporter.js';

export {
  VaultWatcher,
  type SyncEvent,
  type VaultWatcherOptions,
} from './watcher.js';

export {
  SyncManager,
  type SyncManagerOptions,
} from './sync-manager.js';

export {
  assessCanonicalSourceReadiness,
  type CanonicalReadinessLevel,
  type CanonicalSourceAssessment,
  type CanonicalSourceAssessmentInput,
} from './readiness.js';
