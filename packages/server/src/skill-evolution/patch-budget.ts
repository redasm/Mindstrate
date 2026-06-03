import {
  SkillEvolutionPatchOperation,
  SubstrateType,
  type ContextNode,
  type SkillEvolutionPatchBudget,
} from '@mindstrate/protocol/models';

export interface ValidateSkillEvolutionPatchBudgetInput {
  sourceNode: ContextNode | null;
  operation: SkillEvolutionPatchOperation;
  beforeContent: string;
  afterContent: string;
  budget: SkillEvolutionPatchBudget;
}

export interface SkillEvolutionPatchBudgetValidation {
  valid: boolean;
  reason?: 'missing_source_node' | 'unsupported_substrate' | 'operation_content_mismatch' | 'budget_exceeded';
  changedBullets: number;
  changedTokens: number;
}

const HIGH_ORDER_SUBSTRATES = new Set<SubstrateType>([
  SubstrateType.SKILL,
  SubstrateType.RULE,
  SubstrateType.HEURISTIC,
  SubstrateType.AXIOM,
]);

export const validateSkillEvolutionPatchBudget = (
  input: ValidateSkillEvolutionPatchBudgetInput,
): SkillEvolutionPatchBudgetValidation => {
  const changedBullets = countChangedBullets(input.beforeContent, input.afterContent);
  const changedTokens = countChangedTokens(input.beforeContent, input.afterContent);

  if (!input.sourceNode) {
    return { valid: false, reason: 'missing_source_node', changedBullets, changedTokens };
  }
  if (!HIGH_ORDER_SUBSTRATES.has(input.sourceNode.substrateType)) {
    return { valid: false, reason: 'unsupported_substrate', changedBullets, changedTokens };
  }
  if (!operationMatchesContent(input.operation, input.beforeContent, input.afterContent)) {
    return { valid: false, reason: 'operation_content_mismatch', changedBullets, changedTokens };
  }
  if (changedBullets > input.budget.maxChangedBullets || changedTokens > input.budget.maxChangedTokens) {
    return { valid: false, reason: 'budget_exceeded', changedBullets, changedTokens };
  }
  return { valid: true, changedBullets, changedTokens };
};

const operationMatchesContent = (
  operation: SkillEvolutionPatchOperation,
  beforeContent: string,
  afterContent: string,
): boolean => {
  if (beforeContent === afterContent) return false;
  if (operation === SkillEvolutionPatchOperation.ADD) {
    return normalizeLines(afterContent).join('\n').includes(normalizeLines(beforeContent).join('\n'));
  }
  if (operation === SkillEvolutionPatchOperation.DELETE) {
    return normalizeLines(beforeContent).join('\n').includes(normalizeLines(afterContent).join('\n'));
  }
  return true;
};

const countChangedBullets = (beforeContent: string, afterContent: string): number => {
  const before = new Set(extractBulletLines(beforeContent));
  const after = new Set(extractBulletLines(afterContent));
  let changed = 0;
  for (const line of after) {
    if (!before.has(line)) changed++;
  }
  for (const line of before) {
    if (!after.has(line)) changed++;
  }
  return changed;
};

const countChangedTokens = (beforeContent: string, afterContent: string): number => {
  const before = new Set(tokenize(beforeContent));
  const after = new Set(tokenize(afterContent));
  let changed = 0;
  for (const token of after) {
    if (!before.has(token)) changed++;
  }
  for (const token of before) {
    if (!after.has(token)) changed++;
  }
  return changed;
};

const extractBulletLines = (content: string): string[] => {
  const bullets = normalizeLines(content).filter((line) => /^[-*]\s+/.test(line));
  return bullets.length > 0 ? bullets : normalizeLines(content);
};

const normalizeLines = (content: string): string[] =>
  content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

const tokenize = (content: string): string[] =>
  content.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
