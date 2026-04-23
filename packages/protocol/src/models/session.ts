/**
 * Mindstrate - Session Memory Models
 *
 * 会话记忆：解决 LLM 上下文窗口限制问题。
 * 当新开会话时，自动恢复上一次会话的关键上下文。
 */

/** 会话状态 */
export enum SessionStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}

/** 会话记录 */
export interface Session {
  id: string;
  project: string;                // 项目标识（目录名或自定义）
  status: SessionStatus;
  startedAt: string;              // ISO 8601
  endedAt?: string;

  /** 会话摘要（AI 压缩后的核心内容） */
  summary?: string;

  /** 关键决策列表 */
  decisions?: string[];

  /** 进行中的任务 / 未完成的工作 */
  openTasks?: string[];

  /** 遇到的问题和解决方案 */
  problemsSolved?: string[];

  /** 修改过的文件 */
  filesModified?: string[];

  /** 技术栈上下文 */
  techContext?: string;

  /** 完整的观察记录（压缩前，用于后续重压缩） */
  observations?: SessionObservation[];
}

/** 单条会话观察（AI 工作过程中的关键事件） */
export interface SessionObservation {
  timestamp: string;
  type:
    | 'task_start'
    | 'decision'
    | 'problem_solved'
    | 'file_change'
    | 'insight'
    | 'blocker'
    | 'progress'
    /** 决策路径记录：为什么选择方案 A 而不是 B */
    | 'decision_path'
    /** 失败路径记录：这条路走不通的原因 */
    | 'failed_path'
    /** 知识应用记录：检索到的知识是否被采纳（自动反馈闭环） */
    | 'knowledge_applied'
    /** 知识拒绝记录：检索到的知识为何不适用 */
    | 'knowledge_rejected';
  content: string;
  metadata?: Record<string, string>;
}

/** 创建会话的输入 */
export interface CreateSessionInput {
  project?: string;
  techContext?: string;
}

/** 保存会话观察的输入 */
export interface SaveObservationInput {
  sessionId: string;
  type: SessionObservation['type'];
  content: string;
  metadata?: Record<string, string>;
}

/** 压缩会话的输入 */
export interface CompressSessionInput {
  sessionId: string;
  summary: string;
  decisions?: string[];
  openTasks?: string[];
  problemsSolved?: string[];
  filesModified?: string[];
}

/** 恢复会话的输出 */
export interface SessionContext {
  /** 上一次会话的摘要 */
  lastSession?: {
    summary: string;
    decisions: string[];
    openTasks: string[];
    problemsSolved: string[];
    filesModified: string[];
    endedAt: string;
  };
  /** 最近几次会话的简要时间线 */
  recentTimeline?: Array<{
    id: string;
    summary: string;
    endedAt: string;
  }>;
  /** 项目级别的累积上下文 */
  projectContext?: string;
}
