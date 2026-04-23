export {
  detectProject,
  findProjectRoot,
  type DetectedProject,
  type DetectedDependency,
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
