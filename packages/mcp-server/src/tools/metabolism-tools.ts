import { handleMetabolismRun } from './handlers.js';
import { MetabolismRunSchema } from './tool-schemas.js';
import { defineTool } from './tool-types.js';

export const metabolismTools = [
  defineTool({
    name: 'metabolism_run',
    description: 'Run the ECS metabolism engine and return the run summary.',
    schema: MetabolismRunSchema,
    handler: (api, input) => handleMetabolismRun(api, input),
  }),
];
