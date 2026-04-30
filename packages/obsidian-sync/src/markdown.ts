/**
 * Markdown <-> Knowledge converter public surface.
 */

export type {
  MarkdownFrontmatter,
  ParsedMarkdown,
  VaultSyncMode,
} from './markdown-types.js';
export { END_MARKER } from './markdown-types.js';
export {
  computeBodyHash,
  extractBody,
  getVaultSyncMode,
} from './markdown-format.js';
export { parsedToCreate, parsedToUpdate } from './markdown-inputs.js';
export { parseMarkdown } from './markdown-parser.js';
export {
  normalizeObsidianSyncLocale,
  serializeGraphKnowledge,
  type ObsidianSyncLocale,
  type SerializeGraphKnowledgeOptions,
} from './markdown-serializer.js';
