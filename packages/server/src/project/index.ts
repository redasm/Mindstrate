export {
  detectProject,
  findProjectRoot,
  type DetectedProject,
  type DetectedDependency,
  type ProjectChangeFlow,
  type ProjectChangePlaybook,
  type ProjectModuleResponsibility,
  type ProjectOperationManual,
  type ProjectValidationCommand,
  type SuggestedSystemPage,
  type RuleSystemPagePreset,
  type SystemPagePresetLocale,
} from './detector.js';

export {
  buildProjectSnapshot,
  projectSnapshotId,
  extractPreserveBlocks,
  PRESERVE_OPEN,
  PRESERVE_CLOSE,
  type ProjectSnapshotResult,
  type SnapshotOptions,
} from './snapshot.js';

export {
  loadProjectMeta,
  saveProjectMeta,
  dependencyFingerprint,
  metaPath,
  PROJECT_META_DIRNAME,
  PROJECT_META_FILENAME,
  PROJECT_META_VERSION,
  type ProjectMeta,
} from './meta.js';
