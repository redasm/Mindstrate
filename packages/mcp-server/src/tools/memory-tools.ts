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
    description: 'Add a new knowledge entry to the team knowledge base. Pass `project` so `graph_knowledge_search({ project })` can find this entry later — entries without a project scope are reachable via `memory_search` (no project filter) but invisible to the project-aware search path.',
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
    description: 'Record an ECS feedback signal against a `retrievalId` that was previously minted via context_assemble. Use this when you want to score a single ticket explicitly. The `_auto` variant is preferred for the close-the-loop pattern (report every ticket after a context_assemble call); use `memory_feedback` when you need the same write from a different entry point. Rejects unknown retrieval ids loudly so the feedback counters stay trustworthy.',
    schema: MemoryFeedbackSchema,
    handler: (api, input) => handleMemoryFeedback(api, input),
  }),
  defineTool({
    name: 'memory_feedback_auto',
    description: 'Close the feedback loop for one retrieval ticket from a context_assemble response. After answering, you MUST call this once per ticket in the Retrieval Tickets block, passing the `retrievalId` from that block plus `adopted` / `partial` / `ignored` / `rejected` so the priority selector learns which surfaced nodes actually informed the answer. "_auto" refers to the automatic closed-loop pattern (ACE-style generator self-reporting), NOT to any fallback behavior — the tool rejects unknown retrieval ids.',
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
