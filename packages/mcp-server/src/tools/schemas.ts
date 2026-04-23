/**
 * MCP Tool Input Validation Schemas (Zod)
 */

import { KnowledgeType } from '@mindstrate/protocol';
import { z } from 'zod';

export const MemorySearchSchema = z.object({
  query: z.string().min(1, 'query is required'),
  language: z.string().optional(),
  framework: z.string().optional(),
  type: z.nativeEnum(KnowledgeType).optional(),
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

export const ContextConflictsSchema = z.object({
  project: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const MetabolismRunSchema = z.object({
  project: z.string().optional(),
  trigger: z.enum(['manual', 'scheduled', 'event_driven']).optional(),
});

export const MemoryAddSchema = z.object({
  title: z.string().min(1, 'title is required'),
  type: z.nativeEnum(KnowledgeType),
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
  vote: z.enum(['up', 'down']),
});

export const SessionSaveSchema = z.object({
  type: z.enum([
    'task_start', 'decision', 'problem_solved', 'file_change',
    'insight', 'blocker', 'progress',
    'decision_path', 'failed_path', 'knowledge_applied', 'knowledge_rejected',
  ]),
  content: z.string().min(1, 'content is required'),
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

export const MemoryEvolveSchema = z.object({
  autoApply: z.boolean().optional(),
  maxItems: z.number().int().min(1).optional(),
  mode: z.enum(['standard', 'background']).optional(),
});
