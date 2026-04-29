import { CaptureSource, KnowledgeStatus, KnowledgeType } from '@mindstrate/server';
import { END_MARKER, type MarkdownFrontmatter, type VaultSyncMode } from './markdown-types.js';

export function extractBody(text: string): string {
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return text;
  const afterFm = text.slice(fmMatch[0].length);
  const endIdx = afterFm.indexOf(END_MARKER);
  const body = endIdx >= 0 ? afterFm.slice(0, endIdx) : afterFm;
  return body.replace(/\r\n/g, '\n').trim() + '\n';
}

export function computeBodyHash(text: string): string {
  return simpleHash(extractBody(text));
}

export function getVaultSyncMode(type: KnowledgeType): VaultSyncMode {
  switch (type) {
    case KnowledgeType.ARCHITECTURE:
    case KnowledgeType.CONVENTION:
    case KnowledgeType.PATTERN:
    case KnowledgeType.HOW_TO:
    case KnowledgeType.WORKFLOW:
    case KnowledgeType.BEST_PRACTICE:
      return 'editable';
    case KnowledgeType.BUG_FIX:
    case KnowledgeType.GOTCHA:
    case KnowledgeType.TROUBLESHOOTING:
    default:
      return 'mirror';
  }
}

export function graphStatusToKnowledgeStatus(status: string): KnowledgeStatus {
  switch (status) {
    case 'verified':
      return KnowledgeStatus.VERIFIED;
    case 'archived':
      return KnowledgeStatus.OUTDATED;
    case 'active':
      return KnowledgeStatus.ACTIVE;
    default:
      return KnowledgeStatus.PROBATION;
  }
}

export function normalizeFrontmatter(fm: any): MarkdownFrontmatter {
  const type = fm.type as KnowledgeType;
  return {
    id: String(fm.id),
    type,
    tags: Array.isArray(fm.tags) ? fm.tags.map((t: any) => String(t)) : [],
    status: (fm.status as KnowledgeStatus) ?? KnowledgeStatus.PROBATION,
    score: Number(fm.score ?? 50),
    upvotes: Number(fm.upvotes ?? 0),
    downvotes: Number(fm.downvotes ?? 0),
    useCount: Number(fm.useCount ?? 0),
    verified: Boolean(fm.verified),
    source: (fm.source as CaptureSource) ?? CaptureSource.WEB_UI,
    author: String(fm.author ?? 'anonymous'),
    confidence: Number(fm.confidence ?? 0.5),
    createdAt: String(fm.createdAt ?? new Date().toISOString()),
    updatedAt: String(fm.updatedAt ?? new Date().toISOString()),
    expiresAt: fm.expiresAt ? String(fm.expiresAt) : undefined,
    commitHash: fm.commitHash ? String(fm.commitHash) : undefined,
    project: fm.project ? String(fm.project) : undefined,
    language: fm.language ? String(fm.language) : undefined,
    framework: fm.framework ? String(fm.framework) : undefined,
    filePaths: Array.isArray(fm.filePaths) ? fm.filePaths.map(String) : undefined,
    dependencies: Array.isArray(fm.dependencies) ? fm.dependencies.map(String) : undefined,
    bodyHash: fm.bodyHash ? String(fm.bodyHash) : undefined,
    syncedAt: fm.syncedAt ? String(fm.syncedAt) : undefined,
    syncMode: fm.syncMode === 'mirror' || fm.syncMode === 'editable'
      ? fm.syncMode
      : getVaultSyncMode(type),
  };
}

export function escapeTitle(t: string): string {
  return t.replace(/\r?\n/g, ' ').trim();
}

export function round(n: number, digits = 0): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

export function simpleHash(s: string): string {
  let h1 = 0xcbf29ce4 >>> 0;
  let h2 = 0x84222325 >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c;
    h2 ^= c >>> 8;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
