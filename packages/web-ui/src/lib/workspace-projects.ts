import type { Mindstrate } from '@mindstrate/server';

export function listWorkspaceProjects(memory: Mindstrate): string[] {
  const projects = new Set<string>();
  for (const project of memory.context.listKnownProjects()) {
    if (project.trim()) projects.add(project);
  }
  for (const source of memory.scanner.listSources()) {
    if (source.project.trim()) projects.add(source.project);
  }
  return [...projects].sort((a, b) => a.localeCompare(b));
}
