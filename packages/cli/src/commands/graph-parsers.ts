import { execSync } from 'node:child_process';
import {
  ChangeSource,
  MAX_PROJECT_GRAPH_CHANGESET_FILES,
  type ChangedFileStatus,
  type ChangeSet,
} from '@mindstrate/server';

export const parseExternalChangeSetJson = (text: string): ChangeSet => {
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value)) throw new Error('ChangeSet JSON must be an object.');
  if (!isChangeSource(value.source)) throw new Error('ChangeSet source is required.');
  if (!Array.isArray(value.files)) throw new Error('ChangeSet files must be an array.');
  if (value.files.length > MAX_PROJECT_GRAPH_CHANGESET_FILES) {
    throw new Error(`ChangeSet files cannot exceed ${MAX_PROJECT_GRAPH_CHANGESET_FILES} entries.`);
  }

  return {
    source: value.source,
    base: optionalString(value.base, 'base'),
    head: optionalString(value.head, 'head'),
    files: value.files.map(parseExternalChangedFile),
  };
};

export const parseChangeSource = (value: string): ChangeSource => {
  if (value === ChangeSource.GIT) return ChangeSource.GIT;
  if (value === ChangeSource.MANUAL) return ChangeSource.MANUAL;
  throw new Error(`Unsupported graph changes source: ${value}`);
};

export const gitChangedFiles = (cwd: string): string[] =>
  parseGitStatusPorcelainChangedFiles(execSync('git status --porcelain=v2', { cwd, encoding: 'utf8' }));

export const parseGitStatusPorcelainChangedFiles = (output: string): string[] =>
  output.split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseGitStatusPath)
    .filter((file): file is string => !!file);

const parseGitStatusPath = (line: string): string | null => {
  if (line.startsWith('? ')) return line.slice(2).trim();
  if (line.startsWith('1 ')) return splitAtSpaces(line, 8).rest.trim() || null;
  if (line.startsWith('2 ')) {
    const pathPair = splitAtSpaces(line, 9).rest.trim();
    return (pathPair.split('\t')[0] ?? '').trim() || null;
  }
  const pathText = line.slice(3).trim();
  if (!pathText) return null;
  const renameSeparator = ' -> ';
  return pathText.includes(renameSeparator)
    ? pathText.slice(pathText.lastIndexOf(renameSeparator) + renameSeparator.length).trim()
    : pathText;
};

const splitAtSpaces = (line: string, count: number): { rest: string } => {
  let index = 0;
  for (let seen = 0; seen < count; seen += 1) {
    index = line.indexOf(' ', index);
    if (index < 0) return { rest: '' };
    while (line[index] === ' ') index += 1;
  }
  return { rest: line.slice(index) };
};

const parseExternalChangedFile = (value: unknown): ChangeSet['files'][number] => {
  if (!isRecord(value)) throw new Error('Changed file entries must be objects.');
  const filePath = requiredString(value.path, 'path').replace(/\\/g, '/');
  const status = value.status;
  if (!isChangedFileStatus(status)) throw new Error(`Unsupported changed file status: ${String(status)}`);
  return {
    path: filePath,
    status,
    oldPath: optionalString(value.oldPath, 'oldPath')?.replace(/\\/g, '/'),
    language: optionalString(value.language, 'language'),
    layerId: optionalString(value.layerId, 'layerId'),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isChangeSource = (value: unknown): value is ChangeSource =>
  Object.values(ChangeSource).includes(value as ChangeSource);

const isChangedFileStatus = (value: unknown): value is ChangedFileStatus =>
  value === 'added' || value === 'modified' || value === 'deleted' || value === 'renamed' || value === 'moved';

const requiredString = (value: unknown, field: string): string => {
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error(`Changed file ${field} is required.`);
};

const optionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  throw new Error(`ChangeSet ${field} must be a string when provided.`);
};
