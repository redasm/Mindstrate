import type {
  ActionableGuide,
  CaptureSource,
  CodeSnippet,
  KnowledgeStatus,
  KnowledgeType,
} from '@mindstrate/server';

export const END_MARKER = '<!-- mindstrate:end -->';
export type VaultSyncMode = 'editable' | 'mirror';

export interface MarkdownFrontmatter {
  id: string;
  type: KnowledgeType;
  tags: string[];
  status: KnowledgeStatus;
  score: number;
  upvotes: number;
  downvotes: number;
  useCount: number;
  verified: boolean;
  source: CaptureSource;
  author: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  commitHash?: string;
  project?: string;
  language?: string;
  framework?: string;
  filePaths?: string[];
  dependencies?: string[];
  bodyHash?: string;
  syncedAt?: string;
  syncMode?: VaultSyncMode;
}

export interface ParsedMarkdown {
  frontmatter: MarkdownFrontmatter;
  title: string;
  problem?: string;
  solution: string;
  codeSnippets?: CodeSnippet[];
  actionable?: ActionableGuide;
  userNotes?: string;
}
