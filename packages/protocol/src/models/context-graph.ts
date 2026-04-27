/**
 * Mindstrate - ECS Context Graph Models
 *
 * These models describe the evolvable context substrate (ECS) layer.
 * They are intentionally orthogonal to domain-level knowledge types:
 * a bug fix can exist as an episode, summary, rule, etc.
 */

export enum SubstrateType {
  EPISODE = 'episode',
  SNAPSHOT = 'snapshot',
  SUMMARY = 'summary',
  PATTERN = 'pattern',
  SKILL = 'skill',
  RULE = 'rule',
  HEURISTIC = 'heuristic',
  AXIOM = 'axiom',
}

export enum ContextDomainType {
  BUG_FIX = 'bug_fix',
  BEST_PRACTICE = 'best_practice',
  ARCHITECTURE = 'architecture',
  CONVENTION = 'convention',
  PATTERN = 'pattern',
  TROUBLESHOOTING = 'troubleshooting',
  GOTCHA = 'gotcha',
  HOW_TO = 'how_to',
  WORKFLOW = 'workflow',
  PROJECT_SNAPSHOT = 'project_snapshot',
  SESSION_SUMMARY = 'session_summary',
  CONTEXT_EVENT = 'context_event',
}

export enum ContextNodeStatus {
  CANDIDATE = 'candidate',
  ACTIVE = 'active',
  VERIFIED = 'verified',
  DEPRECATED = 'deprecated',
  ARCHIVED = 'archived',
  CONFLICTED = 'conflicted',
}

export enum ContextRelationType {
  FOLLOWS = 'follows',
  CAUSES = 'causes',
  SUPPORTS = 'supports',
  CONTRADICTS = 'contradicts',
  GENERALIZES = 'generalizes',
  INSTANTIATES = 'instantiates',
  DERIVED_FROM = 'derived_from',
  APPLIES_TO = 'applies_to',
  DEPENDS_ON = 'depends_on',
  OBSERVED_IN = 'observed_in',
}

export enum ContextEventType {
  SESSION_OBSERVATION = 'session_observation',
  KNOWLEDGE_WRITE = 'knowledge_write',
  PROJECT_SNAPSHOT = 'project_snapshot',
  FEEDBACK_SIGNAL = 'feedback_signal',
  TOOL_RESULT = 'tool_result',
  TEST_RESULT = 'test_result',
  GIT_ACTIVITY = 'git_activity',
  LSP_DIAGNOSTIC = 'lsp_diagnostic',
  TERMINAL_OUTPUT = 'terminal_output',
  USER_EDIT = 'user_edit',
  METABOLIC_OUTPUT = 'metabolic_output',
}

export interface ContextNode {
  id: string;
  substrateType: SubstrateType;
  domainType: ContextDomainType;
  title: string;
  content: string;
  tags: string[];
  project?: string;
  compressionLevel: number;
  confidence: number;
  qualityScore: number;
  status: ContextNodeStatus;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  accessCount: number;
  positiveFeedback: number;
  negativeFeedback: number;
}

export interface ContextEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: ContextRelationType;
  strength: number;
  evidence?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ContextEvent {
  id: string;
  type: ContextEventType;
  project?: string;
  sessionId?: string;
  actor?: string;
  content: string;
  metadata?: Record<string, unknown>;
  observedAt: string;
  createdAt: string;
}

const VALID_SUBSTRATE_TYPES = new Set(Object.values(SubstrateType));
const VALID_CONTEXT_DOMAIN_TYPES = new Set(Object.values(ContextDomainType));
const VALID_CONTEXT_NODE_STATUSES = new Set(Object.values(ContextNodeStatus));
const VALID_CONTEXT_RELATION_TYPES = new Set(Object.values(ContextRelationType));
const VALID_CONTEXT_EVENT_TYPES = new Set(Object.values(ContextEventType));

export function isValidSubstrateType(value: string): value is SubstrateType {
  return VALID_SUBSTRATE_TYPES.has(value as SubstrateType);
}

export function isValidContextDomainType(value: string): value is ContextDomainType {
  return VALID_CONTEXT_DOMAIN_TYPES.has(value as ContextDomainType);
}

export function isValidContextNodeStatus(value: string): value is ContextNodeStatus {
  return VALID_CONTEXT_NODE_STATUSES.has(value as ContextNodeStatus);
}

export function isValidContextRelationType(value: string): value is ContextRelationType {
  return VALID_CONTEXT_RELATION_TYPES.has(value as ContextRelationType);
}

export function isValidContextEventType(value: string): value is ContextEventType {
  return VALID_CONTEXT_EVENT_TYPES.has(value as ContextEventType);
}
