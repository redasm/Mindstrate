import {
  SkillEvolutionPatchOperation,
  type SkillEvolutionPatchBudget,
} from '@mindstrate/protocol/models';
import type { ProviderFactory } from '../processing/provider-factory.js';
import type { OpenAIClient } from '../openai-client.js';
import { contentLanguageInstruction } from '../content-locale.js';
import type { ProposePatchInput, SkillPatchProposal } from './skill-evolution-optimizer.js';

export interface LlmSkillPatchProposerDeps {
  providerFactory: Pick<ProviderFactory, 'forProject'>;
  /** Default change budget when the model omits one. */
  defaultBudget?: SkillEvolutionPatchBudget;
}

const buildSystemPrompt = (): string => [
  'You optimize a single reusable agent skill document.',
  'Return ONLY a JSON object with these fields:',
  '- operation: "add" | "delete" | "replace"',
  '- afterContent: the full revised skill text',
  '- rationale: one sentence explaining the bounded change',
  '- maxChangedBullets: integer change budget for bullet lines',
  '- maxChangedTokens: integer change budget for tokens',
  'Rules: make the smallest useful edit. For "add", afterContent must contain the original text verbatim.',
  'Never rewrite the whole document. Preserve evidence and intent.',
  contentLanguageInstruction(),
].join('\n');

const DEFAULT_BUDGET: SkillEvolutionPatchBudget = {
  maxChangedBullets: 3,
  maxChangedTokens: 60,
};

/**
 * Real LLM proposer for the skill evolution optimizer. It only produces a
 * structured `SkillPatchProposal`; it never touches the graph or the gate
 * — the optimizer still routes the proposal through the budget validator
 * and the validation gate. Fails closed: any missing client, malformed
 * JSON, or missing field yields `null` so the optimizer reports
 * `no_proposal` instead of risking an unbounded edit.
 */
export const createLlmSkillPatchProposer = (
  deps: LlmSkillPatchProposerDeps,
): ((input: ProposePatchInput) => Promise<SkillPatchProposal | null>) => {
  const fallbackBudget = deps.defaultBudget ?? DEFAULT_BUDGET;

  return async (input: ProposePatchInput): Promise<SkillPatchProposal | null> => {
    const providers = deps.providerFactory.forProject(input.project ?? '');
    if (!providers.hasConfig) return null;

    const client = (await providers.llmClientPromise) as OpenAIClient | null;
    if (!client) return null;

    try {
      const response = await client.chat.completions.create({
        model: providers.llmModel,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          {
            role: 'user',
            content: [
              `Skill title: ${input.title}`,
              'Current skill content:',
              input.beforeContent,
            ].join('\n'),
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return null;
      return toProposal(JSON.parse(content), fallbackBudget);
    } catch {
      return null;
    }
  };
};

const toProposal = (
  raw: unknown,
  fallbackBudget: SkillEvolutionPatchBudget,
): SkillPatchProposal | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const operation = parseOperation(record.operation);
  const afterContent = typeof record.afterContent === 'string' ? record.afterContent.trim() : '';
  const rationale = typeof record.rationale === 'string' ? record.rationale.trim() : '';
  if (!operation || !afterContent || !rationale) return null;

  return {
    operation,
    afterContent,
    rationale,
    budget: {
      maxChangedBullets: parsePositiveInt(record.maxChangedBullets, fallbackBudget.maxChangedBullets),
      maxChangedTokens: parsePositiveInt(record.maxChangedTokens, fallbackBudget.maxChangedTokens),
    },
    metadata: { proposedBy: 'llm-skill-patch-proposer' },
  };
};

const parseOperation = (value: unknown): SkillEvolutionPatchOperation | null => {
  if (value === 'add') return SkillEvolutionPatchOperation.ADD;
  if (value === 'delete') return SkillEvolutionPatchOperation.DELETE;
  if (value === 'replace') return SkillEvolutionPatchOperation.REPLACE;
  return null;
};

const parsePositiveInt = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
