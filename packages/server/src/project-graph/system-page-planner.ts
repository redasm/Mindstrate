import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphOverlayKind,
  ProjectGraphProvenance,
  isProjectGraphNode,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { OpenAIClient } from '../openai-client.js';
import type { DetectedProject } from '../project/index.js';
import {
  projectGraphLlmFactBatchSize,
  scheduleProjectGraphLlmRequest,
  type ProjectGraphLlmRequestPolicy,
} from './llm-request-policy.js';
import { contentLanguageInstruction, resolveContentLocale } from '../content-locale.js';
import type { SystemPageDefinition } from './obsidian-system-page-types.js';
import type { CuratedProjectDoc } from './curated-docs.js';

// System page planner 一次性产出多页章节，必须看到足够多的 facts 才能聚类；但对
// DashScope 等严格 TPS/TPM provider，payload 太大会让请求排队或超时。因此它默认
// 跟随 enrichment 的 factBatchSize，并在这里加一个硬上限。
const SYSTEM_PAGE_FACT_CAP = 40;
const SYSTEM_PAGE_TIMEOUT_MS = 60000;
const MAX_PAGES = 10;
const MAX_SECTIONS_PER_PAGE = 8;
const MAX_BULLETS_PER_SECTION = 8;

// Per-fact / per-doc bounds. A single extracted node can carry a very large
// `content` and a huge evidence list; a curated doc excerpt can be long too.
// Without trimming, the serialized payload blew past provider request caps —
// DashScope rejects oversized input with HTTP 400
// "Range of input length should be [1, 1000000]".
const MAX_FACT_CONTENT_CHARS = 2000;
const MAX_FACT_TITLE_CHARS = 300;
const MAX_FACT_EVIDENCE_PATHS = 20;
const MAX_CURATED_DOC_EXCERPT_CHARS = 1500;
// Keep the whole request body well under the smallest provider input cap.
const MAX_PLANNING_PAYLOAD_CHARS = 600_000;

export interface PlanProjectGraphSystemPagesWithLlmInput {
  client: OpenAIClient;
  model: string;
  project: DetectedProject;
  extractedNodes: ContextNode[];
  /** Optional human-authored architecture docs to ground the plan in. */
  curatedDocs?: CuratedProjectDoc[];
  timeoutMs?: number;
  requestPolicy?: ProjectGraphLlmRequestPolicy;
}

const MAX_CURATED_DOCS = 16;

export const planProjectGraphSystemPagesWithLlm = async (
  input: PlanProjectGraphSystemPagesWithLlmInput,
): Promise<SystemPageDefinition[] | null> => {
  const curatedDocs = (input.curatedDocs ?? []).slice(0, MAX_CURATED_DOCS);
  const evidencePaths = collectEvidencePaths(input.extractedNodes);
  for (const doc of curatedDocs) evidencePaths.add(doc.path);
  // Need at least one grounding source — extracted facts or curated docs.
  if (evidencePaths.size === 0) return null;
  const factCap = Math.min(SYSTEM_PAGE_FACT_CAP, projectGraphLlmFactBatchSize(input.requestPolicy));

  const response = await scheduleProjectGraphLlmRequest(() => input.client.chat.completions.create({
    model: input.model,
    temperature: 0.1,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You design Obsidian project-graph system architecture pages for coding agents.',
          contentLanguageInstruction(),
          'Return only JSON. Ground every page in the provided extracted facts and curated documentation; do not invent files, commands, or subsystems.',
          'Curated documentation is human-authored and authoritative — prefer it for architecture intent, conventions, and rationale, and cite its path as an evidence path.',
          'Create 4 to 10 pages. Prefer project-specific pages over generic templates.',
          'Each page must have a stable kebab-case key, a safe markdown fileName, a title, sections, and optional defaultOverlays.',
          'Schema: {"pages":[{"key":"stable-key","fileName":"00-name.md","title":"...","sections":[{"heading":"...","bullets":[{"text":"...","evidencePaths":["path"]}]}],"defaultOverlays":[{"kind":"note|risk|convention|confirmation|correction|rejection","target":"optional target","content":"..."}]}]}.',
        ].join(' '),
      },
      {
        role: 'user',
        content: renderSystemPagePlanningInput(input.project, input.extractedNodes, factCap, curatedDocs),
      },
    ],
  }, { timeout: input.timeoutMs ?? input.requestPolicy?.requestTimeoutMs ?? SYSTEM_PAGE_TIMEOUT_MS }), input.requestPolicy);

  const content = response.choices[0]?.message?.content;
  if (!content) return null;
  return parseSystemPagePlan(content, evidencePaths);
};

const renderSystemPagePlanningInput = (
  project: DetectedProject,
  nodes: ContextNode[],
  factCap: number,
  curatedDocs: CuratedProjectDoc[],
): string => {
  const facts = nodes
    .filter(isProjectGraphNode)
    .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.provenance] === ProjectGraphProvenance.EXTRACTED)
    .sort(compareExtractedFactSalience)
    .slice(0, factCap)
    .map((node) => ({
      id: node.id,
      kind: node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind],
      title: truncate(node.title, MAX_FACT_TITLE_CHARS),
      content: truncate(node.content, MAX_FACT_CONTENT_CHARS),
      evidence: collectNodeEvidencePaths(node).slice(0, MAX_FACT_EVIDENCE_PATHS),
      impactTags: Array.isArray(node.metadata?.['impactTags']) ? node.metadata?.['impactTags'] : [],
    }));
  const docs = curatedDocs.map((doc) => ({
    path: doc.path,
    title: truncate(doc.title, MAX_FACT_TITLE_CHARS),
    excerpt: truncate(doc.excerpt, MAX_CURATED_DOC_EXCERPT_CHARS),
  }));

  const project_ = {
    name: project.name,
    framework: project.framework,
    language: project.language,
    generatedRoots: project.graphHints?.generatedRoots ?? [],
    sourceRoots: project.graphHints?.sourceRoots ?? [],
  };

  // Final safety net: even after per-item trimming, a very large graph can
  // still exceed the provider input cap. Shed the lowest-salience facts (kept
  // last by the salience sort) — then curated docs — until the serialized
  // payload fits, so the planner degrades gracefully instead of 400-ing.
  let payload = JSON.stringify({ project: project_, curatedDocs: docs, facts });
  while (payload.length > MAX_PLANNING_PAYLOAD_CHARS && facts.length > 1) {
    facts.pop();
    payload = JSON.stringify({ project: project_, curatedDocs: docs, facts });
  }
  while (payload.length > MAX_PLANNING_PAYLOAD_CHARS && docs.length > 0) {
    docs.pop();
    payload = JSON.stringify({ project: project_, curatedDocs: docs, facts });
  }
  return payload;
};

const truncate = (value: string, max: number): string =>
  typeof value === 'string' && value.length > max ? `${value.slice(0, max)}…` : (value ?? '');

const parseSystemPagePlan = (content: string, allowedEvidencePaths: Set<string>): SystemPageDefinition[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const pages = (parsed as Record<string, unknown>)['pages'];
  if (!Array.isArray(pages)) return null;

  const locale = resolveContentLocale();
  const normalized = pages
    .slice(0, MAX_PAGES)
    .map((page) => normalizeSystemPage(page, allowedEvidencePaths, locale))
    .filter((page): page is SystemPageDefinition => page !== null);
  return normalized.length > 0 ? normalized : null;
};

const normalizeSystemPage = (
  value: unknown,
  allowedEvidencePaths: Set<string>,
  locale: 'en' | 'zh',
): SystemPageDefinition | null => {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const key = normalizePageKey(input['key']);
  const name = normalizeFileName(input['fileName']);
  const title = singleLineValue(input['title']);
  const rawSections = Array.isArray(input['sections']) ? input['sections'] : [];
  const sections = rawSections
    .slice(0, MAX_SECTIONS_PER_PAGE)
    .flatMap((section) => renderSection(section, allowedEvidencePaths, locale));
  if (!key || !name || !title || sections.length === 0) return null;

  return {
    key,
    name,
    title,
    body: sections,
    overlays: normalizeOverlays(input['defaultOverlays']),
    userNotesPlaceholder: locale === 'zh'
      ? '- 在这里补充项目确认、修正或待确认问题。'
      : '- Add project-specific confirmations, corrections, or open questions here.',
    userNotesTitle: locale === 'zh' ? '用户笔记' : 'User Notes',
    overlayTitle: locale === 'zh' ? '结构化 Overlay' : 'Structured Overlay',
  };
};

const renderSection = (value: unknown, allowedEvidencePaths: Set<string>, locale: 'en' | 'zh'): string[] => {
  if (!value || typeof value !== 'object') return [];
  const section = value as Record<string, unknown>;
  const heading = singleLineValue(section['heading']);
  const bullets = Array.isArray(section['bullets']) ? section['bullets'] : [];
  const lines = bullets
    .slice(0, MAX_BULLETS_PER_SECTION)
    .map((bullet) => renderBullet(bullet, allowedEvidencePaths, locale))
    .filter((line): line is string => line !== null);
  if (!heading || lines.length === 0) return [];
  return [`## ${heading}`, '', ...lines, ''];
};

const renderBullet = (value: unknown, allowedEvidencePaths: Set<string>, locale: 'en' | 'zh'): string | null => {
  if (!value || typeof value !== 'object') return null;
  const bullet = value as Record<string, unknown>;
  const text = singleLineValue(bullet['text']);
  if (!text) return null;
  const evidencePaths = Array.isArray(bullet['evidencePaths'])
    ? bullet['evidencePaths']
      .filter((path): path is string => typeof path === 'string' && allowedEvidencePaths.has(path))
      .slice(0, 5)
    : [];
  const evidenceLabel = locale === 'zh' ? '证据' : 'Evidence';
  return evidencePaths.length > 0 ? `- ${text} ${evidenceLabel}: ${evidencePaths.join(', ')}` : `- ${text}`;
};

const normalizeOverlays = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const overlays = value
    .slice(0, 8)
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const overlay = entry as Record<string, unknown>;
      const kind = normalizeOverlayKind(overlay['kind']);
      const content = singleLineValue(overlay['content']);
      const target = singleLineValue(overlay['target']);
      if (!kind || !content) return [];
      return [
        '- kind: ' + kind,
        ...(target ? ['  target: ' + target] : []),
        '  content: ' + content,
      ];
    });
  return overlays;
};

const normalizeOverlayKind = (value: unknown): ProjectGraphOverlayKind | null => {
  if (typeof value !== 'string') return null;
  return Object.values(ProjectGraphOverlayKind).includes(value as ProjectGraphOverlayKind)
    ? value as ProjectGraphOverlayKind
    : null;
};

const normalizePageKey = (value: unknown): string | null => {
  const key = stringValue(value).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,80}$/.test(key) ? key : null;
};

const normalizeFileName = (value: unknown): string | null => {
  const fileName = stringValue(value);
  if (!fileName.endsWith('.md')) return null;
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) return null;
  if (/[<>:"|?*]/.test(fileName)) return null;
  return fileName.length <= 120 ? fileName : null;
};

const stringValue = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const singleLineValue = (value: unknown): string => stringValue(value).replace(/\s+/g, ' ');

const compareExtractedFactSalience = (a: ContextNode, b: ContextNode): number =>
  salienceScore(b) - salienceScore(a) || a.title.localeCompare(b.title);

const salienceScore = (node: ContextNode): number =>
  node.positiveFeedback * 20 + node.accessCount * 5 + node.qualityScore + collectNodeEvidencePaths(node).length * 2;

const collectEvidencePaths = (nodes: ContextNode[]): Set<string> =>
  new Set(nodes.flatMap(collectNodeEvidencePaths));

const collectNodeEvidencePaths = (node: ContextNode): string[] => {
  const evidence = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence];
  return Array.isArray(evidence)
    ? evidence
      .map((entry) => typeof entry === 'object' && entry && 'path' in entry ? String(entry.path) : '')
      .filter(Boolean)
    : [];
};
