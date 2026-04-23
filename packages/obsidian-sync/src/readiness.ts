export type CanonicalReadinessLevel = 'not_ready' | 'pilot_only' | 'ready';

export interface CanonicalSourceAssessmentInput {
  totalKnowledge: number;
  indexedEntries: number;
  markdownFiles: number;
  editableKnowledge: number;
  mirrorKnowledge: number;
  hasMirrorProtection: boolean;
  hasStaleEditProtection: boolean;
  hasVersionedMerge: boolean;
  hasTeamConflictResolution: boolean;
}

export interface CanonicalSourceAssessment {
  level: CanonicalReadinessLevel;
  summary: {
    totalKnowledge: number;
    indexedEntries: number;
    markdownFiles: number;
    editableKnowledge: number;
    mirrorKnowledge: number;
    drift: number;
  };
  strengths: string[];
  blockers: string[];
  recommendation: string;
}

export function assessCanonicalSourceReadiness(
  input: CanonicalSourceAssessmentInput,
): CanonicalSourceAssessment {
  const drift = input.totalKnowledge - input.indexedEntries;
  const fileDrift = input.indexedEntries - input.markdownFiles;
  const strengths: string[] = [];
  const blockers: string[] = [];

  if (input.hasMirrorProtection) {
    strengths.push('Mirror-only knowledge types are protected from unsafe vault write-back.');
  } else {
    blockers.push('Mirror-only knowledge can still overwrite Mindstrate content.');
  }

  if (input.hasStaleEditProtection) {
    strengths.push('Stale vault edits are detected before they overwrite newer Mindstrate content.');
  } else {
    blockers.push('Vault edits can overwrite newer Mindstrate content without stale-edit detection.');
  }

  if (drift !== 0 || fileDrift !== 0) {
    blockers.push(`Current vault drift is non-zero (knowledge/index drift=${drift}, index/file drift=${fileDrift}).`);
  }

  if (!input.hasVersionedMerge) {
    blockers.push('No versioned merge workflow exists for resolving competing file vs database edits.');
  }

  if (!input.hasTeamConflictResolution) {
    blockers.push('No team conflict resolution policy exists for multi-writer canonical vault workflows.');
  }

  let level: CanonicalReadinessLevel = 'ready';
  if (drift !== 0 || fileDrift !== 0 || !input.hasMirrorProtection || !input.hasStaleEditProtection) {
    level = 'not_ready';
  } else if (!input.hasVersionedMerge || !input.hasTeamConflictResolution) {
    level = 'pilot_only';
  }

  const recommendation = level === 'ready'
    ? 'Canonical vault source is technically viable; proceed only with controlled rollout and backups.'
    : level === 'pilot_only'
      ? 'Canonical vault source is suitable only for limited pilot usage. Keep SQLite as source of truth until merge and team-governance gaps are closed.'
      : 'Canonical vault source is not ready. Keep SQLite as source of truth and use the vault as a guarded collaboration copy.';

  return {
    level,
    summary: {
      totalKnowledge: input.totalKnowledge,
      indexedEntries: input.indexedEntries,
      markdownFiles: input.markdownFiles,
      editableKnowledge: input.editableKnowledge,
      mirrorKnowledge: input.mirrorKnowledge,
      drift,
    },
    strengths,
    blockers,
    recommendation,
  };
}
