import * as yaml from 'yaml';
import { CaptureSource, type GraphKnowledgeView } from '@mindstrate/server';
import { graphDomainToKnowledgeType } from './vault-layout.js';
import { END_MARKER, type MarkdownFrontmatter } from './markdown-types.js';
import {
  escapeTitle,
  getVaultSyncMode,
  graphStatusToKnowledgeStatus,
  round,
  simpleHash,
} from './markdown-format.js';

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
    createdAt: knowledge.createdAt ?? new Date(0).toISOString(),
    updatedAt: knowledge.updatedAt ?? new Date(0).toISOString(),
    syncedAt: options.syncedAt ?? new Date().toISOString(),
    syncMode: getVaultSyncMode(type),
  };
  if (knowledge.project) fm.project = knowledge.project;

  const content = (knowledge.content ?? '').trim();
  const bodyContent = content
    ? content
    : ['## Solution', '', knowledge.summary.trim()].join('\n');
  const body = [
    `# ${escapeTitle(knowledge.title)}`,
    '',
    bodyContent,
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
