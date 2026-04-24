/**
 * Markdown ↔ Knowledge converter
 *
 * Knowledge is serialized to a markdown file with YAML frontmatter.
 * The frontmatter holds machine-readable metadata (id, type, score, tags, ...);
 * the body holds human-editable content (problem, solution, code snippets, actionable guide).
 *
 * Format:
 * ---
 * id: <uuid>
 * type: bug_fix
 * tags: [react, hooks]
 * score: 75
 * status: active
 * ...
 * ---
 *
 * # <title>
 *
 * ## Problem
 * <problem text>
 *
 * ## Solution
 * <solution text>
 *
 * ## Code
 * ```ts
 * // ...
 * ```
 *
 * ## Steps
 * 1. ...
 *
 * ## Verification
 * <verification>
 *
 * ## Anti-patterns
 * - ...
 *
 * ## Preconditions
 * - ...
 *
 * <!-- mindstrate:end -->
 *
 * Anything below the end marker is preserved as user notes (not synced back).
 */

import * as yaml from 'yaml';
import {
  type GraphKnowledgeView,
  type KnowledgeUnit,
  type CreateKnowledgeInput,
  type UpdateKnowledgeInput,
  type CodeSnippet,
  type ActionableGuide,
  KnowledgeType,
  CaptureSource,
  KnowledgeStatus,
} from '@mindstrate/server';

const END_MARKER = '<!-- mindstrate:end -->';
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
  /** SHA256 hash of the canonical body content; used to detect external edits */
  bodyHash?: string;
  /** Last sync time (ISO) */
  syncedAt?: string;
  /** Whether vault edits should sync back into Mindstrate */
  syncMode?: VaultSyncMode;
}

export interface ParsedMarkdown {
  frontmatter: MarkdownFrontmatter;
  /** Title parsed from the first H1 (or fallback to frontmatter) */
  title: string;
  problem?: string;
  solution: string;
  codeSnippets?: CodeSnippet[];
  actionable?: ActionableGuide;
  /** User-only content below the end marker (preserved untouched) */
  userNotes?: string;
}

// ============================================================
// Serialize (Knowledge -> Markdown text)
// ============================================================

export function serializeKnowledge(
  knowledge: KnowledgeUnit,
  options: { syncedAt?: string; preserveUserNotes?: string } = {},
): string {
  const fm: MarkdownFrontmatter = {
    id: knowledge.id,
    type: knowledge.type,
    tags: knowledge.tags ?? [],
    status: knowledge.quality.status,
    score: round(knowledge.quality.score),
    upvotes: knowledge.quality.upvotes,
    downvotes: knowledge.quality.downvotes,
    useCount: knowledge.quality.useCount,
    verified: knowledge.quality.verified,
    source: knowledge.metadata.source,
    author: knowledge.metadata.author,
    confidence: round(knowledge.metadata.confidence, 2),
    createdAt: knowledge.metadata.createdAt,
    updatedAt: knowledge.metadata.updatedAt,
    syncedAt: options.syncedAt ?? new Date().toISOString(),
    syncMode: getVaultSyncMode(knowledge.type),
  };
  if (knowledge.metadata.expiresAt) fm.expiresAt = knowledge.metadata.expiresAt;
  if (knowledge.metadata.commitHash) fm.commitHash = knowledge.metadata.commitHash;
  if (knowledge.context.project) fm.project = knowledge.context.project;
  if (knowledge.context.language) fm.language = knowledge.context.language;
  if (knowledge.context.framework) fm.framework = knowledge.context.framework;
  if (knowledge.context.filePaths?.length) fm.filePaths = knowledge.context.filePaths;
  if (knowledge.context.dependencies?.length) fm.dependencies = knowledge.context.dependencies;

  const bodyParts: string[] = [];
  bodyParts.push(`# ${escapeTitle(knowledge.title)}`);

  if (knowledge.problem?.trim()) {
    bodyParts.push('', '## Problem', '', knowledge.problem.trim());
  }

  bodyParts.push('', '## Solution', '', knowledge.solution.trim());

  if (knowledge.codeSnippets?.length) {
    bodyParts.push('', '## Code');
    for (const snip of knowledge.codeSnippets) {
      const header = snip.description ? `\n_${snip.description}_\n` : '';
      const lang = snip.language || '';
      const fp = snip.filePath ? `\n_File: \`${snip.filePath}\`_\n` : '';
      bodyParts.push('', header, fp, '```' + lang, snip.code.replace(/\r\n/g, '\n'), '```');
    }
  }

  if (knowledge.actionable) {
    const a = knowledge.actionable;
    if (a.preconditions?.length) {
      bodyParts.push('', '## Preconditions', '', ...a.preconditions.map(p => `- ${p}`));
    }
    if (a.steps?.length) {
      bodyParts.push('', '## Steps', '', ...a.steps.map((s, i) => `${i + 1}. ${s}`));
    }
    if (a.verification) {
      bodyParts.push('', '## Verification', '', a.verification);
    }
    if (a.antiPatterns?.length) {
      bodyParts.push('', '## Anti-patterns', '', ...a.antiPatterns.map(p => `- ${p}`));
    }
    if (a.relatedKnowledge?.length) {
      bodyParts.push('', '## Related', '', ...a.relatedKnowledge.map(id => `- [[${id}]]`));
    }
  }

  const body = bodyParts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';

  // Compute body hash for change detection (excludes user notes)
  fm.bodyHash = simpleHash(body);

  const fmText = yaml.stringify(fm, { lineWidth: 0 });
  let out = `---\n${fmText}---\n\n${body}\n${END_MARKER}\n`;
  if (options.preserveUserNotes) {
    out += '\n' + options.preserveUserNotes.trimStart();
    if (!out.endsWith('\n')) out += '\n';
  }
  return out;
}

export function serializeGraphKnowledge(
  knowledge: GraphKnowledgeView,
  options: { syncedAt?: string; preserveUserNotes?: string } = {},
): string {
  const type = graphDomainToKnowledgeType(knowledge.domainType);
  const fm: MarkdownFrontmatter = {
    id: knowledge.id,
    type,
    tags: knowledge.tags ?? [],
    status: graphStatusToKnowledgeStatus(knowledge.status),
    score: round(knowledge.priorityScore * 100),
    upvotes: 0,
    downvotes: 0,
    useCount: 0,
    verified: knowledge.status === 'verified',
    source: CaptureSource.AUTO_DETECT,
    author: 'ecs-graph',
    confidence: round(knowledge.priorityScore, 2),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    syncedAt: options.syncedAt ?? new Date().toISOString(),
    syncMode: 'mirror',
  };
  if (knowledge.project) fm.project = knowledge.project;

  const body = [
    `# ${escapeTitle(knowledge.title)}`,
    '',
    '## Summary',
    '',
    knowledge.summary.trim(),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';

  fm.bodyHash = simpleHash(body);

  const fmText = yaml.stringify(fm, { lineWidth: 0 });
  let out = `---\n${fmText}---\n\n${body}\n${END_MARKER}\n`;
  if (options.preserveUserNotes) {
    out += '\n' + options.preserveUserNotes.trimStart();
    if (!out.endsWith('\n')) out += '\n';
  }
  return out;
}

// ============================================================
// Parse (Markdown text -> Knowledge fields)
// ============================================================

export function parseMarkdown(text: string): ParsedMarkdown | null {
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return null;
  const rawFm = fmMatch[1];
  let fm: MarkdownFrontmatter;
  try {
    fm = yaml.parse(rawFm) as MarkdownFrontmatter;
  } catch {
    return null;
  }
  if (!fm || !fm.id || !fm.type) return null;

  const afterFm = text.slice(fmMatch[0].length);
  const endIdx = afterFm.indexOf(END_MARKER);
  const body = endIdx >= 0 ? afterFm.slice(0, endIdx) : afterFm;
  const userNotes = endIdx >= 0 ? afterFm.slice(endIdx + END_MARKER.length).trim() : undefined;

  // Parse title: first H1
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = (titleMatch?.[1] ?? '').trim();

  // Section parser: split body by H2 headings
  const sections = splitSections(body);

  const problem = sections.get('problem');
  const solution = sections.get('solution') ?? '';

  const codeSnippets = parseCodeSnippets(sections.get('code'));
  const actionable = parseActionable(sections);

  return {
    frontmatter: normalizeFrontmatter(fm),
    title: title || 'Untitled',
    problem: problem || undefined,
    solution: solution.trim(),
    codeSnippets: codeSnippets.length > 0 ? codeSnippets : undefined,
    actionable,
    userNotes: userNotes || undefined,
  };
}

/**
 * Compute the body hash from a parsed markdown's body section
 * (everything between frontmatter and end marker).
 */
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

function graphDomainToKnowledgeType(domainType: string): KnowledgeType {
  return Object.values(KnowledgeType).includes(domainType as KnowledgeType)
    ? domainType as KnowledgeType
    : KnowledgeType.BEST_PRACTICE;
}

function graphStatusToKnowledgeStatus(status: string): KnowledgeStatus {
  switch (status) {
    case 'verified':
      return KnowledgeStatus.VERIFIED;
    case 'deprecated':
    case 'archived':
      return KnowledgeStatus.DEPRECATED;
    case 'active':
      return KnowledgeStatus.ACTIVE;
    default:
      return KnowledgeStatus.PROBATION;
  }
}

/**
 * Convert a ParsedMarkdown into UpdateKnowledgeInput for writing back to Mindstrate.
 * Title is taken from the parsed body and overrides anything else.
 */
export function parsedToUpdate(parsed: ParsedMarkdown): UpdateKnowledgeInput {
  return {
    title: parsed.title,
    problem: parsed.problem,
    solution: parsed.solution,
    codeSnippets: parsed.codeSnippets,
    tags: parsed.frontmatter.tags ?? [],
    actionable: parsed.actionable,
    confidence: parsed.frontmatter.confidence,
    context: {
      project: parsed.frontmatter.project,
      language: parsed.frontmatter.language,
      framework: parsed.frontmatter.framework,
      filePaths: parsed.frontmatter.filePaths,
      dependencies: parsed.frontmatter.dependencies,
    },
  };
}

/**
 * Convert a ParsedMarkdown into CreateKnowledgeInput, used when a markdown
 * file exists in the vault but no corresponding KU exists in Mindstrate.
 */
export function parsedToCreate(parsed: ParsedMarkdown): CreateKnowledgeInput {
  return {
    type: parsed.frontmatter.type,
    title: parsed.title,
    problem: parsed.problem,
    solution: parsed.solution,
    codeSnippets: parsed.codeSnippets,
    tags: parsed.frontmatter.tags ?? [],
    author: parsed.frontmatter.author,
    source: parsed.frontmatter.source ?? CaptureSource.WEB_UI,
    confidence: parsed.frontmatter.confidence ?? 0.5,
    actionable: parsed.actionable,
    commitHash: parsed.frontmatter.commitHash,
    context: {
      project: parsed.frontmatter.project,
      language: parsed.frontmatter.language,
      framework: parsed.frontmatter.framework,
      filePaths: parsed.frontmatter.filePaths,
      dependencies: parsed.frontmatter.dependencies,
    },
  };
}

// ============================================================
// Helpers
// ============================================================

function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split(/\r?\n/);
  let currentKey: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (currentKey !== null) {
      sections.set(currentKey, buf.join('\n').trim());
    }
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      currentKey = m[1].toLowerCase().trim();
      buf = [];
    } else {
      if (currentKey !== null) buf.push(line);
    }
  }
  flush();
  return sections;
}

function parseCodeSnippets(section: string | undefined): CodeSnippet[] {
  if (!section) return [];
  const snippets: CodeSnippet[] = [];
  // Match fenced code blocks with optional preceding description and file path
  const lines = section.split('\n');
  let i = 0;
  let description: string | undefined;
  let filePath: string | undefined;
  while (i < lines.length) {
    const line = lines[i];
    const descMatch = line.match(/^_(.+)_\s*$/);
    const fileMatch = line.match(/^_File:\s+`(.+)`_\s*$/);
    if (fileMatch) {
      filePath = fileMatch[1];
      i++;
      continue;
    }
    if (descMatch && !fileMatch) {
      description = descMatch[1];
      i++;
      continue;
    }
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1];
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      snippets.push({
        language: lang || 'text',
        code: codeLines.join('\n'),
        filePath,
        description,
      });
      description = undefined;
      filePath = undefined;
      continue;
    }
    i++;
  }
  return snippets;
}

function parseActionable(sections: Map<string, string>): ActionableGuide | undefined {
  const preconditions = parseBulletList(sections.get('preconditions'));
  const steps = parseNumberedOrBulletList(sections.get('steps'));
  const verification = sections.get('verification');
  const antiPatterns = parseBulletList(sections.get('anti-patterns'));
  const related = parseRelatedLinks(sections.get('related'));

  if (
    !preconditions.length &&
    !steps.length &&
    !verification &&
    !antiPatterns.length &&
    !related.length
  ) {
    return undefined;
  }
  const guide: ActionableGuide = {};
  if (preconditions.length) guide.preconditions = preconditions;
  if (steps.length) guide.steps = steps;
  if (verification) guide.verification = verification;
  if (antiPatterns.length) guide.antiPatterns = antiPatterns;
  if (related.length) guide.relatedKnowledge = related;
  return guide;
}

function parseBulletList(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map(l => l.match(/^[-*]\s+(.+)$/)?.[1]?.trim())
    .filter((x): x is string => Boolean(x));
}

function parseNumberedOrBulletList(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map(l => l.match(/^(?:\d+\.|[-*])\s+(.+)$/)?.[1]?.trim())
    .filter((x): x is string => Boolean(x));
}

function parseRelatedLinks(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map(l => l.match(/^[-*]\s+\[\[([^\]]+)\]\]/)?.[1]?.trim())
    .filter((x): x is string => Boolean(x));
}

function normalizeFrontmatter(fm: any): MarkdownFrontmatter {
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

function escapeTitle(t: string): string {
  return t.replace(/\r?\n/g, ' ').trim();
}

function round(n: number, digits = 0): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

/**
 * FNV-1a 64-bit hash, returned as hex.
 * Pure JS, no crypto dependency. Good enough for change-detection.
 */
function simpleHash(s: string): string {
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
