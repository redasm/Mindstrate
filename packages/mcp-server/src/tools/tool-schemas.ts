import { z } from 'zod';

export const MemorySearchSchema = z.object({
  query: z.string().min(1, 'query is required'),
  language: z.string().optional(),
  framework: z.string().optional(),
  type: z.string().min(1).optional(),
  topK: z.number().int().min(1).max(50).optional(),
});

export const GraphKnowledgeSearchSchema = z.object({
  query: z.string().min(1, 'query is required'),
  project: z.string().optional(),
  topK: z.number().int().min(1).max(50).optional(),
});

export const ContextIngestEventSchema = z.object({
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

export const ContextQueryGraphSchema = z.object({
  query: z.string().optional(),
  project: z.string().optional(),
  substrateType: z.string().optional(),
  domainType: z.string().optional(),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const ContextEdgesSchema = z.object({
  sourceId: z.string().optional(),
  targetId: z.string().optional(),
  relationType: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const ProjectGraphQuerySchema = z.object({
  query: z.string().min(1, 'query is required'),
  project: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const ProjectGraphNodeSchema = z.object({
  id: z.string().min(1, 'id is required'),
  project: z.string().optional(),
});

export const ProjectGraphNeighborsSchema = z.object({
  id: z.string().min(1, 'id is required'),
  project: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const ProjectGraphPathSchema = z.object({
  from: z.string().min(1, 'from is required'),
  to: z.string().min(1, 'to is required'),
  project: z.string().optional(),
  maxDepth: z.number().int().min(1).max(20).optional(),
});

export const ProjectGraphBlastRadiusSchema = z.object({
  id: z.string().min(1, 'id is required'),
  project: z.string().optional(),
  depth: z.number().int().min(1).max(5).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const ContextConflictsSchema = z.object({
  project: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const ContextConflictAcceptSchema = z.object({
  conflictId: z.string().min(1, 'conflictId is required'),
  candidateNodeId: z.string().min(1, 'candidateNodeId is required'),
  resolution: z.string().min(1, 'resolution is required'),
});

export const ContextConflictRejectSchema = z.object({
  conflictId: z.string().min(1, 'conflictId is required'),
  candidateNodeId: z.string().min(1, 'candidateNodeId is required'),
  reason: z.string().min(1, 'reason is required'),
});

export const MetabolismRunSchema = z.object({
  project: z.string().optional(),
  trigger: z.enum(['manual', 'scheduled', 'event_driven']).optional(),
  stage: z.enum(['digest', 'assimilate', 'compress', 'prune', 'reflect']).optional(),
});

export const ObsidianProjectionWriteSchema = z.object({
  rootDir: z.string().min(1, 'rootDir is required'),
  project: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const ObsidianProjectionImportSchema = z.object({
  filePath: z.string().min(1, 'filePath is required'),
});

export const BundleCreateSchema = z.object({
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

export const BundleValidateSchema = z.object({
  bundle: BundlePayloadSchema,
});

export const BundleInstallSchema = z.object({
  bundle: BundlePayloadSchema.optional(),
  registry: z.string().optional(),
  reference: z.string().optional(),
});

export const BundlePublishSchema = z.object({
  bundle: BundlePayloadSchema,
  registry: z.string().optional(),
  visibility: z.enum(['public', 'private', 'unlisted']).optional(),
});

export const MemoryAddSchema = z.object({
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

export const MemoryFeedbackSchema = z.object({
  id: z.string().min(1, 'id is required'),
  signal: z.enum(['adopted', 'rejected', 'ignored', 'partial']),
  context: z.string().optional(),
});

export const SessionStartSchema = z.object({
  project: z.string().optional(),
  techContext: z.string().optional(),
});

export const SessionSaveSchema = z.object({
  type: z.enum([
    'task_start', 'decision', 'problem_solved', 'file_change',
    'insight', 'blocker', 'progress',
    'decision_path', 'failed_path', 'knowledge_applied', 'knowledge_rejected',
  ]),
  content: z.string().min(1, 'content is required'),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const SessionEndSchema = z.object({
  summary: z.string().optional(),
  openTasks: z.array(z.string()).optional(),
});

export const SessionRestoreSchema = z.object({
  project: z.string().optional(),
});

export const MemoryFeedbackAutoSchema = z.object({
  retrievalId: z.string().min(1, 'retrievalId is required'),
  signal: z.enum(['adopted', 'rejected', 'ignored', 'partial']),
  context: z.string().optional(),
});

export const MemoryCurateSchema = z.object({
  task: z.string().min(1, 'task is required'),
  language: z.string().optional(),
  framework: z.string().optional(),
});

export const ContextAssembleSchema = z.object({
  task: z.string().min(1, 'task is required'),
  project: z.string().optional(),
  language: z.string().optional(),
  framework: z.string().optional(),
});

export const ContextInternalizeSchema = z.object({
  project: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  accept: z.boolean().optional(),
  targets: z.array(z.enum(['agents_md', 'project_snapshot', 'system_prompt', 'fine_tune_dataset'])).optional(),
});

export const MemoryEvolveSchema = z.object({
  autoApply: z.boolean().optional(),
  maxItems: z.number().int().min(1).optional(),
  mode: z.enum(['standard', 'background']).optional(),
});
