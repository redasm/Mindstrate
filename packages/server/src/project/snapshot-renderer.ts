import * as path from 'node:path';
import type { DetectedProject } from './detector.js';
import { truncateText } from '../text-format.js';
import {
  PRESERVE_CLOSE,
  PRESERVE_OPEN,
  type PreservedBlocks,
} from './snapshot-preserve.js';

export const snapshotTitle = (project: DetectedProject): string => {
  const stack = [project.language, project.framework].filter(Boolean).join(' / ');
  return stack
    ? `Project Snapshot: ${project.name} — ${stack}`
    : `Project Snapshot: ${project.name}`;
};

export const renderSnapshotMarkdown = (
  project: DetectedProject,
  preserved: PreservedBlocks,
): string => {
  const lines: string[] = [];

  appendOverview(lines, project);
  appendTechStack(lines, project);
  appendDependencies(lines, project);
  appendEntryPoints(lines, project);
  appendScripts(lines, project);
  appendDirectoryLayout(lines, project);
  appendWorkspaces(lines, project);
  appendPreservedSection(lines, 'Architecture & Lifecycle', [
    '_Document how this project boots, what owns each resource, and how data flows._',
  ], preserved.architecture ?? '<!-- Add or refine your architecture notes here. They are kept across `mindstrate init` re-runs. -->');
  appendPreservedSection(lines, 'Critical Invariants', [
    '_Properties that hold globally across the system. AI assistants should NOT add defensive code that contradicts these._',
  ], preserved.invariants ?? [
    '<!-- Examples (delete and replace with your own):',
    '- The Model singleton is initialized at startup; runtime code may assume it is non-null.',
    '- Configuration is frozen after boot; do not mutate it from request handlers.',
    '- All DB writes go through the repository layer; never call the driver directly.',
    '-->',
  ].join('\n'));
  appendPreservedSection(lines, 'Conventions', [], preserved.conventions ?? '<!-- e.g. file naming, error handling, logging, test layout, commit message format -->');
  appendPreservedSection(lines, 'Notes', [], preserved.notes ?? '<!-- Free-form notes preserved across `mindstrate init` runs. -->');
  appendFooter(lines, project);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
};

export const buildSnapshotTags = (project: DetectedProject): string[] => {
  const tags = new Set<string>(['project-snapshot']);
  if (project.language) tags.add(project.language);
  if (project.framework) tags.add(project.framework);
  if (project.packageManager) tags.add(project.packageManager);
  return Array.from(tags);
};

export const snapshotSolutionsEqual = (left: string, right: string): boolean =>
  normalizeSnapshotSolution(left) === normalizeSnapshotSolution(right);

const appendOverview = (lines: string[], project: DetectedProject): void => {
  lines.push('## Overview', '');
  if (project.description) lines.push(project.description);
  if (project.readmeExcerpt) {
    if (project.description) lines.push('');
    lines.push(project.readmeExcerpt);
  }
  if (!project.description && !project.readmeExcerpt) {
    lines.push(`Project _${project.name}_ at \`${path.basename(project.root)}\`.`);
  }
  lines.push('');
};

const appendTechStack = (lines: string[], project: DetectedProject): void => {
  lines.push('## Tech Stack', '');
  if (project.language) lines.push(`- **Language:** ${project.language}`);
  if (project.framework) lines.push(`- **Framework:** ${project.framework}`);
  if (project.runtime) lines.push(`- **Runtime:** ${project.runtime}`);
  if (project.packageManager) lines.push(`- **Package manager:** ${project.packageManager}`);
  if (project.version) lines.push(`- **Version:** ${project.version}`);
  if (project.git?.isRepo && project.git.branch) {
    lines.push(`- **Git branch:** ${project.git.branch}${project.git.remote ? ` (\`${project.git.remote}\`)` : ''}`);
  }
  lines.push('');
};

const appendDependencies = (lines: string[], project: DetectedProject): void => {
  if (!project.dependencies.length) return;

  lines.push('## Dependencies', '');
  appendDependencyGroup(lines, 'Runtime', project.dependencies.filter((dependency) => dependency.kind === 'prod'));
  appendDependencyGroup(lines, 'Dev', project.dependencies.filter((dependency) => dependency.kind === 'dev'));
  appendDependencyGroup(lines, 'Optional', project.dependencies.filter((dependency) => dependency.kind === 'optional'));
  if (project.truncatedDeps > 0) {
    lines.push(`_(+${project.truncatedDeps} more dependencies omitted)_`, '');
  }
};

const appendDependencyGroup = (
  lines: string[],
  label: string,
  dependencies: DetectedProject['dependencies'],
): void => {
  if (!dependencies.length) return;
  lines.push(`**${label}:**`);
  dependencies.forEach((dependency) => lines.push(`- \`${dependency.name}\` ${dependency.version}`));
  lines.push('');
};

const appendEntryPoints = (lines: string[], project: DetectedProject): void => {
  if (!project.entryPoints.length) return;
  lines.push('## Entry Points', '');
  project.entryPoints.forEach((entryPoint) => lines.push(`- \`${entryPoint}\``));
  lines.push('');
};

const appendScripts = (lines: string[], project: DetectedProject): void => {
  const scriptKeys = Object.keys(project.scripts);
  if (!scriptKeys.length) return;
  lines.push('## Scripts', '');
  scriptKeys.slice(0, 20).forEach((key) => {
    lines.push(`- \`${key}\` → \`${truncateText(project.scripts[key], 80, '…')}\``);
  });
  lines.push('');
};

const appendDirectoryLayout = (lines: string[], project: DetectedProject): void => {
  if (!project.topDirs.length) return;
  lines.push('## Directory Layout', '');
  project.topDirs.forEach((directory) => lines.push(`- \`${directory}/\``));
  lines.push('');
};

const appendWorkspaces = (lines: string[], project: DetectedProject): void => {
  if (!project.workspaces?.length) return;
  lines.push('## Workspaces', '');
  project.workspaces.forEach((workspace) => lines.push(`- \`${workspace}\``));
  lines.push('');
};

const appendPreservedSection = (
  lines: string[],
  title: string,
  intro: string[],
  content: string,
): void => {
  lines.push(`## ${title}`, '');
  lines.push(...intro);
  if (intro.length > 0) lines.push('');
  lines.push(PRESERVE_OPEN, content, PRESERVE_CLOSE, '');
};

const appendFooter = (lines: string[], project: DetectedProject): void => {
  lines.push('---');
  lines.push(`_Detected: ${project.detectedAt} • Manifest: ${project.manifestPath ?? '(none)'} • Root: \`${project.root}\`_`);
};

const normalizeSnapshotSolution = (solution: string): string => solution
  .replace(/_Detected: [^\n]*_/g, '')
  .replace(/\s+/g, ' ')
  .trim();

