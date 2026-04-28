import type { ConflictRecord, ContextNode } from '@mindstrate/protocol/models';

export interface SummarySection {
  priority: number;
  content: string;
}

export const formatSummarySection = (title: string, items: string[]): string => [
  `\n### ${title}`,
  ...items.map((item) => `- ${item}`),
].join('\n');

export const clipSummaryByBudget = (
  base: string,
  sections: SummarySection[],
  maxCharacters: number,
): string => {
  if (maxCharacters <= 0) return '';

  const candidates = [
    ...sections,
    { priority: 30, content: base },
  ];
  const selected = candidates
    .slice()
    .sort((a, b) => b.priority - a.priority)
    .reduce<string[]>((acc, section) => {
      const candidate = [...acc, section.content].join('\n');
      if (candidate.length <= maxCharacters) {
        return [...acc, section.content];
      }
      return acc;
    }, []);

  const summary = [
    ...selected.filter((section) => section === base),
    ...selected.filter((section) => section !== base),
  ].join('\n');
  if (summary.length <= maxCharacters) {
    return summary;
  }
  return `${summary.slice(0, Math.max(maxCharacters - 1, 0))}…`;
};

export const buildEvidenceTrail = (
  project: string | undefined,
  sessionContext: string | undefined,
  projectSnapshot: ContextNode | undefined,
  graphRules: ContextNode[],
  graphPatterns: ContextNode[],
  graphSummaries: ContextNode[],
  graphConflicts: ConflictRecord[],
): string[] => {
  const trail: string[] = [];
  if (sessionContext) {
    trail.push(`session:${project ?? 'default'}`);
  }
  if (projectSnapshot) {
    trail.push(`project-snapshot:${projectSnapshot.id}`);
  }
  trail.push(...graphRules.map((node) => `rule:${node.id}`));
  trail.push(...graphPatterns.map((node) => `pattern:${node.id}`));
  trail.push(...graphSummaries.map((node) => `summary:${node.id}`));
  trail.push(...graphConflicts.map((record) => `conflict:${record.id}`));
  return trail;
};

