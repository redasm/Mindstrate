import * as yaml from 'yaml';
import type { ActionableGuide, CodeSnippet } from '@mindstrate/server';
import { END_MARKER, type MarkdownFrontmatter, type ParsedMarkdown } from './markdown-types.js';
import { normalizeFrontmatter } from './markdown-format.js';

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

  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = (titleMatch?.[1] ?? '').trim();
  const sections = splitSections(body);
  const problem = sections.get('problem');
  const solution = sections.get('solution') ?? plainBodyWithoutTitle(body);
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
    } else if (currentKey !== null) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

function plainBodyWithoutTitle(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !line.match(/^#\s+.+$/))
    .join('\n')
    .trim();
}

function parseCodeSnippets(section: string | undefined): CodeSnippet[] {
  if (!section) return [];
  const snippets: CodeSnippet[] = [];
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
      i++;
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
