import { CaptureSource, type CreateKnowledgeInput, type UpdateKnowledgeInput } from '@mindstrate/server';
import type { ParsedMarkdown } from './markdown-types.js';

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
