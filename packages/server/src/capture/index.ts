export { KnowledgeExtractor, type CommitInfo, type ExtractionResult } from './extractor.js';
export {
  getGitRoot,
  getLastCommit,
  getCommitInfo,
  getRecentCommits,
  installGitHook,
  uninstallGitHook,
} from './git-hook.js';
export {
  isP4Available,
  isP4Connected,
  getChangelistInfo,
  getRecentChangelists,
  getPendingChangelists,
} from './p4.js';
