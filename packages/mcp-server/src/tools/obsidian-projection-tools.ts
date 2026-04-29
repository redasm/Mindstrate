import {
  handleObsidianProjectionImport,
  handleObsidianProjectionWrite,
} from './handlers.js';
import {
  ObsidianProjectionImportSchema,
  ObsidianProjectionWriteSchema,
} from './tool-schemas.js';
import { defineTool } from './tool-types.js';

export const obsidianProjectionTools = [
  defineTool({
    name: 'context_obsidian_projection_write',
    description: 'Write verified ECS knowledge as editable Obsidian markdown projection files.',
    schema: ObsidianProjectionWriteSchema,
    handler: (api, input) => handleObsidianProjectionWrite(api, input),
  }),
  defineTool({
    name: 'context_obsidian_projection_import',
    description: 'Import an edited ECS Obsidian projection markdown file as a candidate graph node.',
    schema: ObsidianProjectionImportSchema,
    handler: (api, input) => handleObsidianProjectionImport(api, input),
  }),
];
