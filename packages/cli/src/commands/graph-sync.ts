import * as path from 'node:path';
import {
  ProjectGraphOverlayKind,
  ProjectGraphOverlaySource,
} from '@mindstrate/server';
import type { ProjectCliConfig } from '../cli-config.js';
import type { createMemory } from '../memory-factory.js';
import type { ProjectGraphTeamClient } from './init.js';

export const resolveGraphSyncPlan = (input: {
  projectName: string;
  config: ProjectCliConfig | null;
  vaultPath?: string;
  teamServerUrl?: string;
}): { mode: 'local' | 'team'; teamServerUrl?: string; obsidianFile?: string } => {
  if (input.teamServerUrl || input.config?.mode === 'team') {
    return {
      mode: 'team',
      teamServerUrl: input.teamServerUrl ?? input.config?.teamServerUrl,
      obsidianFile: undefined,
    };
  }
  const vaultPath = input.vaultPath ?? input.config?.vaultPath;
  return {
    mode: 'local',
    teamServerUrl: undefined,
    obsidianFile: vaultPath
      ? path.join(vaultPath, slugifyProjectName(input.projectName), 'architecture', 'project-graph.md')
      : undefined,
  };
};

export const extractProjectGraphUserNotes = (text: string): string => {
  const start = '<!-- mindstrate:project-graph:user-notes:start -->';
  const end = '<!-- mindstrate:project-graph:user-notes:end -->';
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return '';
  const notes = text.slice(startIndex + start.length, endIndex).trim();
  return notes === '- Add architecture notes, confirmations, corrections, or risks here.' ? '' : notes;
};

export const upsertObsidianProjectGraphNoteOverlay = (
  memory: ReturnType<typeof createMemory>,
  project: string,
  content: string,
): boolean => {
  const existing = memory.context.listProjectGraphOverlays({ project, limit: 500 })
    .find((overlay) =>
      overlay.source === ProjectGraphOverlaySource.OBSIDIAN
      && overlay.kind === ProjectGraphOverlayKind.NOTE
      && !overlay.targetNodeId
      && !overlay.targetEdgeId
      && overlay.content === content);
  if (existing) return false;
  memory.context.createProjectGraphOverlay({
    project,
    kind: ProjectGraphOverlayKind.NOTE,
    content,
    source: ProjectGraphOverlaySource.OBSIDIAN,
    author: 'obsidian',
  });
  return true;
};

export const createGraphSyncTeamClient = async (
  serverUrl?: string,
  apiKey?: string,
): Promise<ProjectGraphTeamClient> => {
  if (!serverUrl) throw new Error('TEAM_SERVER_URL or --team-server-url is required for team graph sync.');
  // Lazy-load keeps local-only CLI commands usable in downstream packages that omit the client bundle.
  const { TeamClient } = await import('@mindstrate/client');
  return new TeamClient({
    serverUrl,
    apiKey: apiKey ?? process.env['TEAM_API_KEY'],
  });
};

const slugifyProjectName = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
