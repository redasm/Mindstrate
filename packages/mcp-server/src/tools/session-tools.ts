import {
  handleSessionEnd,
  handleSessionRestore,
  handleSessionSave,
  handleSessionStart,
} from './handlers.js';
import {
  SessionEndSchema,
  SessionRestoreSchema,
  SessionSaveSchema,
  SessionStartSchema,
} from './tool-schemas.js';
import { defineTool } from './tool-types.js';

export const sessionTools = [
  defineTool({
    name: 'session_start',
    description: 'Start a new coding session and receive context from previous sessions.',
    schema: SessionStartSchema,
    handler: (api, input, session) => handleSessionStart(api, input, session),
  }),
  defineTool({
    name: 'session_save',
    description: 'Save an important observation during the current session.',
    schema: SessionSaveSchema,
    handler: (api, input, session) => handleSessionSave(api, input, session),
  }),
  defineTool({
    name: 'session_end',
    description: 'End the current session and compress observations into a summary.',
    schema: SessionEndSchema,
    handler: (api, input, session) => handleSessionEnd(api, input, session),
  }),
  defineTool({
    name: 'session_restore',
    description: 'Restore context from previous sessions.',
    schema: SessionRestoreSchema,
    handler: (api, input) => handleSessionRestore(api, input),
  }),
];
