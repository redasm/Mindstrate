import {
  handleContextAssemble,
  handleContextConflictAccept,
  handleContextConflictReject,
  handleContextConflicts,
  handleContextEdges,
  handleContextIngestEvent,
  handleContextInternalize,
  handleContextQueryGraph,
} from './handlers.js';
import {
  ContextAssembleSchema,
  ContextConflictAcceptSchema,
  ContextConflictRejectSchema,
  ContextConflictsSchema,
  ContextEdgesSchema,
  ContextIngestEventSchema,
  ContextInternalizeSchema,
  ContextQueryGraphSchema,
} from './tool-schemas.js';
import { defineTool } from './tool-types.js';

export const contextTools = [
  defineTool({
    name: 'context_ingest_event',
    description: 'Ingest a low-level ECS context event and materialize it as an episode node.',
    schema: ContextIngestEventSchema,
    handler: (api, input) => handleContextIngestEvent(api, input),
  }),
  defineTool({
    name: 'context_query_graph',
    description: 'Query ECS context graph nodes directly.',
    schema: ContextQueryGraphSchema,
    handler: (api, input) => handleContextQueryGraph(api, input),
  }),
  defineTool({
    name: 'context_edges',
    description: 'List ECS graph edges and relationships.',
    schema: ContextEdgesSchema,
    handler: (api, input) => handleContextEdges(api, input),
  }),
  defineTool({
    name: 'context_conflicts',
    description: 'List active ECS conflict records for a project or the entire graph.',
    schema: ContextConflictsSchema,
    handler: (api, input) => handleContextConflicts(api, input),
  }),
  defineTool({
    name: 'context_conflict_accept',
    description: 'Accept a reflected conflict-resolution candidate and mark the source conflict resolved.',
    schema: ContextConflictAcceptSchema,
    handler: (api, input) => handleContextConflictAccept(api, input),
  }),
  defineTool({
    name: 'context_conflict_reject',
    description: 'Reject a reflected conflict-resolution candidate without resolving the source conflict.',
    schema: ContextConflictRejectSchema,
    handler: (api, input) => handleContextConflictReject(api, input),
  }),
  defineTool({
    name: 'context_assemble',
    description: 'Assemble a full working context for a task.',
    schema: ContextAssembleSchema,
    handler: (api, input) => handleContextAssemble(api, input),
  }),
  defineTool({
    name: 'context_internalize',
    description: 'Generate or accept internalization suggestions from stable ECS knowledge.',
    schema: ContextInternalizeSchema,
    handler: (api, input) => handleContextInternalize(api, input),
  }),
];
