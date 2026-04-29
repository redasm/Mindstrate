import {
  handleGraphKnowledgeSearch,
  handleMemoryAdd,
  handleMemoryCurate,
  handleMemoryEvolve,
  handleMemoryFeedback,
  handleMemoryFeedbackAuto,
  handleMemorySearch,
} from './handlers.js';
import {
  GraphKnowledgeSearchSchema,
  MemoryAddSchema,
  MemoryCurateSchema,
  MemoryEvolveSchema,
  MemoryFeedbackAutoSchema,
  MemoryFeedbackSchema,
  MemorySearchSchema,
} from './tool-schemas.js';
import { defineTool } from './tool-types.js';

export const memoryTools = [
  defineTool({
    name: 'memory_search',
    description: 'Search the team knowledge base for relevant solutions, best practices, and coding patterns.',
    schema: MemorySearchSchema,
    handler: (api, input) => handleMemorySearch(api, input),
  }),
  defineTool({
    name: 'memory_add',
    description: 'Add a new knowledge entry to the team knowledge base.',
    schema: MemoryAddSchema,
    handler: (api, input) => handleMemoryAdd(api, input),
  }),
  defineTool({
    name: 'graph_knowledge_search',
    description: 'Search ECS-native graph knowledge views derived from high-level context nodes.',
    schema: GraphKnowledgeSearchSchema,
    handler: (api, input) => handleGraphKnowledgeSearch(api, input),
  }),
  defineTool({
    name: 'memory_feedback',
    description: 'Record an ECS feedback signal for a context node or retrieval result.',
    schema: MemoryFeedbackSchema,
    handler: (api, input) => handleMemoryFeedback(api, input),
  }),
  defineTool({
    name: 'memory_feedback_auto',
    description: 'Record automatic feedback on a previously retrieved knowledge entry.',
    schema: MemoryFeedbackAutoSchema,
    handler: (api, input) => handleMemoryFeedbackAuto(api, input),
  }),
  defineTool({
    name: 'memory_curate',
    description: 'Get a curated knowledge package for a specific task.',
    schema: MemoryCurateSchema,
    handler: (api, input) => handleMemoryCurate(api, input),
  }),
  defineTool({
    name: 'memory_evolve',
    description: 'Run the knowledge evolution engine to identify improvements, merges, and deprecations.',
    schema: MemoryEvolveSchema,
    handler: (api, input) => handleMemoryEvolve(api, input),
  }),
];
