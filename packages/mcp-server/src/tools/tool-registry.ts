import { z } from 'zod';
import type { McpApi, McpToolResponse, SessionState } from '../types.js';
import {
  handleBundleCreate,
  handleBundleInstall,
  handleBundlePublish,
  handleBundleValidate,
  handleContextAssemble,
  handleContextConflicts,
  handleContextConflictAccept,
  handleContextConflictReject,
  handleContextEdges,
  handleContextIngestEvent,
  handleContextInternalize,
  handleContextQueryGraph,
  handleGraphKnowledgeSearch,
  handleMemoryAdd,
  handleMemoryCurate,
  handleMemoryEvolve,
  handleMemoryFeedback,
  handleMemoryFeedbackAuto,
  handleMemorySearch,
  handleMetabolismRun,
  handleObsidianProjectionImport,
  handleObsidianProjectionWrite,
  handleSessionEnd,
  handleSessionRestore,
  handleSessionSave,
  handleSessionStart,
} from './handlers.js';

type ToolHandler<Input> = (api: McpApi, input: Input, session: SessionState) => Promise<McpToolResponse>;

interface ToolSpec<Input> {
  name: string;
  description: string;
  schema: z.ZodType<Input>;
  handler: ToolHandler<Input>;
}

const MemorySearchSchema = z.object({
  query: z.string().min(1, 'query is required'),
  language: z.string().optional(),
  framework: z.string().optional(),
  type: z.string().min(1).optional(),
  topK: z.number().int().min(1).max(50).optional(),
});

const GraphKnowledgeSearchSchema = z.object({
  query: z.string().min(1, 'query is required'),
  project: z.string().optional(),
  topK: z.number().int().min(1).max(50).optional(),
});

const ContextIngestEventSchema = z.object({
  type: z.string().min(1, 'type is required'),
  content: z.string().min(1, 'content is required'),
  project: z.string().optional(),
  sessionId: z.string().optional(),
  actor: z.string().optional(),
  domainType: z.string().optional(),
  substrateType: z.string().optional(),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ContextQueryGraphSchema = z.object({
  query: z.string().optional(),
  project: z.string().optional(),
  substrateType: z.string().optional(),
  domainType: z.string().optional(),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const ContextEdgesSchema = z.object({
  sourceId: z.string().optional(),
  targetId: z.string().optional(),
  relationType: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const ContextConflictsSchema = z.object({
  project: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const ContextConflictAcceptSchema = z.object({
  conflictId: z.string().min(1, 'conflictId is required'),
  candidateNodeId: z.string().min(1, 'candidateNodeId is required'),
  resolution: z.string().min(1, 'resolution is required'),
});

const ContextConflictRejectSchema = z.object({
  conflictId: z.string().min(1, 'conflictId is required'),
  candidateNodeId: z.string().min(1, 'candidateNodeId is required'),
  reason: z.string().min(1, 'reason is required'),
});

const MetabolismRunSchema = z.object({
  project: z.string().optional(),
  trigger: z.enum(['manual', 'scheduled', 'event_driven']).optional(),
  stage: z.enum(['digest', 'assimilate', 'compress', 'prune', 'reflect']).optional(),
});

const ObsidianProjectionWriteSchema = z.object({
  rootDir: z.string().min(1, 'rootDir is required'),
  project: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const ObsidianProjectionImportSchema = z.object({
  filePath: z.string().min(1, 'filePath is required'),
});

const BundleCreateSchema = z.object({
  name: z.string().min(1, 'name is required'),
  version: z.string().optional(),
  description: z.string().optional(),
  project: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
  includeRelatedEdges: z.boolean().optional(),
});

const BundlePayloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  projectScoped: z.boolean(),
  nodeIds: z.array(z.string()),
  edgeIds: z.array(z.string()),
  exportedAt: z.string().min(1),
  nodes: z.array(z.object({
    id: z.string(),
    substrateType: z.string(),
    domainType: z.string(),
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
    project: z.string().optional(),
    compressionLevel: z.number(),
    confidence: z.number(),
    qualityScore: z.number(),
    status: z.string(),
    sourceRef: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
  edges: z.array(z.object({
    id: z.string(),
    sourceId: z.string(),
    targetId: z.string(),
    relationType: z.string(),
    strength: z.number(),
    evidence: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
});

const BundleValidateSchema = z.object({
  bundle: BundlePayloadSchema,
});

const BundleInstallSchema = z.object({
  bundle: BundlePayloadSchema.optional(),
  registry: z.string().optional(),
  reference: z.string().optional(),
});

const BundlePublishSchema = z.object({
  bundle: BundlePayloadSchema,
  registry: z.string().optional(),
  visibility: z.enum(['public', 'private', 'unlisted']).optional(),
});

const MemoryAddSchema = z.object({
  title: z.string().min(1, 'title is required'),
  type: z.string().min(1, 'type is required'),
  problem: z.string().optional(),
  solution: z.string().min(1, 'solution is required'),
  tags: z.array(z.string()).optional(),
  language: z.string().optional(),
  framework: z.string().optional(),
  actionable: z.object({
    preconditions: z.array(z.string()).optional(),
    steps: z.array(z.string()).optional(),
    verification: z.string().optional(),
    antiPatterns: z.array(z.string()).optional(),
  }).optional(),
});

const MemoryFeedbackSchema = z.object({
  id: z.string().min(1, 'id is required'),
  signal: z.enum(['adopted', 'rejected', 'ignored', 'partial']),
  context: z.string().optional(),
});

const SessionStartSchema = z.object({
  project: z.string().optional(),
  techContext: z.string().optional(),
});

const SessionSaveSchema = z.object({
  type: z.enum([
    'task_start', 'decision', 'problem_solved', 'file_change',
    'insight', 'blocker', 'progress',
    'decision_path', 'failed_path', 'knowledge_applied', 'knowledge_rejected',
  ]),
  content: z.string().min(1, 'content is required'),
  metadata: z.record(z.string(), z.string()).optional(),
});

const SessionEndSchema = z.object({
  summary: z.string().optional(),
  openTasks: z.array(z.string()).optional(),
});

const SessionRestoreSchema = z.object({
  project: z.string().optional(),
});

const MemoryFeedbackAutoSchema = z.object({
  retrievalId: z.string().min(1, 'retrievalId is required'),
  signal: z.enum(['adopted', 'rejected', 'ignored', 'partial']),
  context: z.string().optional(),
});

const MemoryCurateSchema = z.object({
  task: z.string().min(1, 'task is required'),
  language: z.string().optional(),
  framework: z.string().optional(),
});

const ContextAssembleSchema = z.object({
  task: z.string().min(1, 'task is required'),
  project: z.string().optional(),
  language: z.string().optional(),
  framework: z.string().optional(),
});

const ContextInternalizeSchema = z.object({
  project: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  accept: z.boolean().optional(),
  targets: z.array(z.enum(['agents_md', 'project_snapshot', 'system_prompt', 'fine_tune_dataset'])).optional(),
});

const MemoryEvolveSchema = z.object({
  autoApply: z.boolean().optional(),
  maxItems: z.number().int().min(1).optional(),
  mode: z.enum(['standard', 'background']).optional(),
});

function defineTool<Input>(spec: ToolSpec<Input>): ToolSpec<Input> {
  return spec;
}

export const toolRegistry = [
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
    name: 'metabolism_run',
    description: 'Run the ECS metabolism engine and return the run summary.',
    schema: MetabolismRunSchema,
    handler: (api, input) => handleMetabolismRun(api, input),
  }),
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
  defineTool({
    name: 'bundle_create',
    description: 'Create a portable ECS context bundle from the current graph.',
    schema: BundleCreateSchema,
    handler: (api, input) => handleBundleCreate(api, input),
  }),
  defineTool({
    name: 'bundle_validate',
    description: 'Validate a portable ECS context bundle payload.',
    schema: BundleValidateSchema,
    handler: (api, input) => handleBundleValidate(api, input),
  }),
  defineTool({
    name: 'bundle_install',
    description: 'Install a portable ECS context bundle payload or local registry reference.',
    schema: BundleInstallSchema,
    handler: (api, input) => handleBundleInstall(api, input),
  }),
  defineTool({
    name: 'bundle_publish',
    description: 'Publish or prepare a portable ECS context bundle for distribution.',
    schema: BundlePublishSchema,
    handler: (api, input) => handleBundlePublish(api, input),
  }),
  defineTool({
    name: 'memory_feedback',
    description: 'Record an ECS feedback signal for a context node or retrieval result.',
    schema: MemoryFeedbackSchema,
    handler: (api, input) => handleMemoryFeedback(api, input),
  }),
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
  defineTool({
    name: 'memory_evolve',
    description: 'Run the knowledge evolution engine to identify improvements, merges, and deprecations.',
    schema: MemoryEvolveSchema,
    handler: (api, input) => handleMemoryEvolve(api, input),
  }),
];

export const toolByName = new Map(toolRegistry.map((tool) => [tool.name, tool]));

export const TOOL_DEFINITIONS = toolRegistry.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: z.toJSONSchema(tool.schema) as Record<string, unknown>,
}));
