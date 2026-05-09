import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphOverlayKind,
  ProjectGraphProvenance,
  isProjectGraphNode,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { OpenAIClient } from '../openai-client.js';
import type { DetectedProject } from '../project/index.js';
import { projectGraphLanguageInstruction, resolveProjectGraphLocale } from './project-graph-locale.js';
import type { SystemPageDefinition } from './project-graph-obsidian-projection.js';

const SYSTEM_PAGE_FACT_CAP = 80;
const SYSTEM_PAGE_TIMEOUT_MS = 120000;
const MAX_PAGES = 10;
const MAX_SECTIONS_PER_PAGE = 8;
const MAX_BULLETS_PER_SECTION = 8;

export interface PlanProjectGraphSystemPagesWithLlmInput {
  client: OpenAIClient;
  model: string;
  project: DetectedProject;
  extractedNodes: ContextNode[];
  timeoutMs?: number;
}

export const planProjectGraphSystemPagesWithLlm = async (
  input: PlanProjectGraphSystemPagesWithLlmInput,
): Promise<SystemPageDefinition[] | null> => {
  const evidencePaths = collectEvidencePaths(input.extractedNodes);
  if (evidencePaths.size === 0) return null;

  const response = await input.client.chat.completions.create({
    model: input.model,
    temperature: 0.1,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You design Obsidian project-graph system architecture pages for coding agents.',
          projectGraphLanguageInstruction(),
          'Return only JSON. Use only provided facts and evidence paths; do not invent files, commands, or subsystems.',
          'Create 4 to 10 pages. Prefer project-specific pages over generic templates.',
          'Each page must have a stable kebab-case key, a safe markdown fileName, a title, sections, and optional defaultOverlays.',
          'Schema: {"pages":[{"key":"stable-key","fileName":"00-name.md","title":"...","sections":[{"heading":"...","bullets":[{"text":"...","evidencePaths":["path"]}]}],"defaultOverlays":[{"kind":"note|risk|convention|confirmation|correction|rejection","target":"optional target","content":"..."}]}]}.',
        ].join(' '),
      },
      {
        role: 'user',
        content: renderSystemPagePlanningInput(input.project, input.extractedNodes),
      },
    ],
  }, { timeout: input.timeoutMs ?? SYSTEM_PAGE_TIMEOUT_MS });

  const content = response.choices[0]?.message?.content;
  if (!content) return null;
  return parseSystemPagePlan(content, evidencePaths);
};

const renderSystemPagePlanningInput = (project: DetectedProject, nodes: ContextNode[]): string => {
  const facts = nodes
    .filter(isProjectGraphNode)
    .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.provenance] === ProjectGraphProvenance.EXTRACTED)
    .sort(compareExtractedFactSalience)
    .slice(0, SYSTEM_PAGE_FACT_CAP)
    .map((node) => ({
      id: node.id,
      kind: node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind],
      title: node.title,
      content: node.content,
      evidence: collectNodeEvidencePaths(node),
      impactTags: Array.isArray(node.metadata?.['impactTags']) ? node.metadata?.['impactTags'] : [],
    }));
  return JSON.stringify({
    project: {
      name: project.name,
      framework: project.framework,
      language: project.language,
      generatedRoots: project.graphHints?.generatedRoots ?? [],
      sourceRoots: project.graphHints?.sourceRoots ?? [],
    },
    facts,
  });
};

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

  const locale = resolveProjectGraphLocale();
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
