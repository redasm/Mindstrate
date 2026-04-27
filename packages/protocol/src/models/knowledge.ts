/**
 * Mindstrate - Graph knowledge input models
 *
 * These contracts describe graph write inputs and context assembly payloads.
 * Runtime read results are graph projections, not unit records.
 */

// ============================================================
// Enums
// ============================================================

/** 知识类型 */
export enum KnowledgeType {
  BUG_FIX = 'bug_fix',
  BEST_PRACTICE = 'best_practice',
  ARCHITECTURE = 'architecture',
  CONVENTION = 'convention',
  PATTERN = 'pattern',
  TROUBLESHOOTING = 'troubleshooting',
  GOTCHA = 'gotcha',
  HOW_TO = 'how_to',
  /** 可执行工作流/步骤化规程 */
  WORKFLOW = 'workflow',
}

/** 采集来源 */
export enum CaptureSource {
  GIT_HOOK = 'git_hook',
  IDE_PLUGIN = 'ide_plugin',
  CLI = 'cli',
  WEB_UI = 'web_ui',
  PR_REVIEW = 'pr_review',
  AI_CONVERSATION = 'ai_conversation',
  AUTO_DETECT = 'auto_detect',
  P4_TRIGGER = 'p4_trigger',
}

/** 知识生命周期状态 */
export enum KnowledgeStatus {
  PROBATION = 'probation',
  ACTIVE = 'active',
  VERIFIED = 'verified',
  DEPRECATED = 'deprecated',
  OUTDATED = 'outdated',
}

// ============================================================
// Interfaces
// ============================================================

/** 代码片段 */
export interface CodeSnippet {
  language: string;
  code: string;
  filePath?: string;
  description?: string;
}

/** 知识上下文 */
export interface KnowledgeContext {
  project?: string;
  language?: string;
  framework?: string;
  filePaths?: string[];
  dependencies?: string[];
}

/** 知识元数据 */
export interface KnowledgeMetadata {
  author: string;
  source: CaptureSource;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
  expiresAt?: string;  // ISO 8601
  commitHash?: string;
  confidence: number;  // 0-1
}

/** 知识质量信息 */
export interface KnowledgeQuality {
  score: number;       // 0-100
  upvotes: number;
  downvotes: number;
  useCount: number;
  lastUsedAt?: string; // ISO 8601
  verified: boolean;
  status: KnowledgeStatus;
}

/**
 * 可执行行为指导
 *
 * 让知识不仅是静态描述，更是可执行的步骤化规程。
 */
export interface ActionableGuide {
  /** 适用的前置条件（什么情况下应使用此知识） */
  preconditions?: string[];
  /** 具体步骤 */
  steps?: string[];
  /** 如何验证问题已解决 */
  verification?: string;
  /** 常见错误做法（"Red Flags"） */
  antiPatterns?: string[];
  /** 关联知识 ID 列表 */
  relatedKnowledge?: string[];
}

/**
 * 知识进化记录
 *
 * 追踪每条知识的进化历程：合并、改进、验证等。
 */
export interface EvolutionRecord {
  /** 进化类型 */
  type: 'created' | 'merged' | 'improved' | 'validated' | 'invalidated';
  /** 进化时间 */
  timestamp: string;
  /** 描述 */
  description: string;
  /** 相关知识 ID（如合并来源） */
  relatedIds?: string[];
  /** 进化前后得分变化 */
  scoreBefore?: number;
  scoreAfter?: number;
}

// ============================================================
// Input types (用于创建/更新时的输入，不需要填所有字段)
// ============================================================

/** 创建知识的输入 */
export interface CreateKnowledgeInput {
  type: string;
  title: string;
  problem?: string;
  solution: string;
  codeSnippets?: CodeSnippet[];
  tags?: string[];
  context?: Partial<KnowledgeContext>;
  author?: string;
  source?: CaptureSource;
  commitHash?: string;
  confidence?: number;
  /** 可执行指导 */
  actionable?: ActionableGuide;
}

/** 更新知识的输入 */
export interface UpdateKnowledgeInput {
  title?: string;
  problem?: string;
  solution?: string;
  codeSnippets?: CodeSnippet[];
  tags?: string[];
  context?: Partial<KnowledgeContext>;
  confidence?: number;
  /** 可执行指导 */
  actionable?: ActionableGuide;
}

/** 检索过滤条件 */
export interface RetrievalFilter {
  language?: string;
  framework?: string;
  project?: string;
  types?: string[];
  tags?: string[];
  minScore?: number;
  status?: KnowledgeStatus[];
}

/** 检索上下文 */
export interface RetrievalContext {
  project?: string;
  currentFile?: string;
  currentLanguage?: string;
  currentFramework?: string;
  errorMessage?: string;
  recentCode?: string;
  projectDependencies?: string[];
  userQuery?: string;
  conversationSummary?: string;
}

/**
 * 自动反馈事件（自动反馈闭环系统）
 *
 * 追踪：图检索 → 使用 → 结果 → 图节点反馈计数
 */
export interface FeedbackEvent {
  /** 唯一 ID */
  id: string;
  /** 被检索的图节点 ID */
  nodeId: string;
  /** 检索时的查询 */
  query: string;
  /** 检索时间 */
  retrievedAt: string;
  /** 反馈信号 */
  signal: 'pending' | 'adopted' | 'rejected' | 'ignored' | 'partial';
  /** 反馈时间 */
  respondedAt?: string;
  /** 额外上下文 */
  context?: string;
  /** 所属会话 */
  sessionId?: string;
}

/**
 * 上下文策划结果
 *
 * 针对特定任务自动组装的知识包
 */
export interface CuratedContext {
  /** 任务描述 */
  taskDescription: string;
  /** 高层图规则 */
  graphRules?: string[];
  /** 高层图模式 */
  graphPatterns?: string[];
  /** 图中的近期总结 */
  graphSummaries?: string[];
  /** 当前活跃冲突 */
  graphConflicts?: string[];
  /** 最相关的图知识列表 */
  knowledge: import('./projection.js').GraphKnowledgeSearchResult[];
  /** 相关的工作流/步骤图知识 */
  workflows: import('./projection.js').GraphKnowledgeSearchResult[];
  /** 相关的反模式/踩坑图知识 */
  warnings: import('./projection.js').GraphKnowledgeSearchResult[];
  /** 策划摘要 */
  summary: string;
}

export interface AssembledContext {
  taskDescription: string;
  project?: string;
  sessionContext?: string;
  projectSnapshot?: import('./context-graph.js').ContextNode;
  graphSummaries?: string[];
  graphPatterns?: string[];
  graphRules?: string[];
  graphConflicts?: string[];
  sessionContinuity?: {
    project?: string;
    content: string;
  };
  projectSubstrate?: {
    project?: string;
    snapshotTitle?: string;
    snapshot?: import('./context-graph.js').ContextNode;
  };
  taskRelevantPatterns?: string[];
  applicableSkills?: string[];
  activeRules?: string[];
  knownConflicts?: string[];
  warnings?: string[];
  evidenceTrail?: string[];
  curated: CuratedContext;
  summary: string;
}

// ============================================================
// Validation helpers
// ============================================================

const VALID_KNOWLEDGE_TYPES = new Set(Object.values(KnowledgeType));

/** 校验是否为合法的 KnowledgeType */
export function isValidKnowledgeType(value: string): value is KnowledgeType {
  return VALID_KNOWLEDGE_TYPES.has(value as KnowledgeType);
}
