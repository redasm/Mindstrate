import { describe, expect, it } from 'vitest';
import { SkillEvolutionPatchOperation } from '@mindstrate/protocol/models';
import { createLlmSkillPatchProposer } from '../src/skill-evolution/llm-skill-patch-proposer.js';

interface FakeChatResponse {
  content: string | null;
}

const fakeProviderFactory = (response: FakeChatResponse | null, hasConfig = true) => ({
  forProject: () => ({
    hasConfig,
    llmModel: 'fake-model',
    llmClientPromise: Promise.resolve(
      response === null
        ? null
        : {
          chat: {
            completions: {
              create: async () => ({ choices: [{ message: { content: response.content } }] }),
            },
          },
        },
    ),
  }),
});

const proposeInput = {
  nodeId: 'node-1',
  project: 'mindstrate',
  beforeContent: '- Use broad guidance',
  title: 'Skill',
};

describe('createLlmSkillPatchProposer', () => {
  it('parses a valid JSON proposal from the model', async () => {
    const propose = createLlmSkillPatchProposer({
      providerFactory: fakeProviderFactory({
        content: JSON.stringify({
          operation: 'add',
          afterContent: '- Use broad guidance\n- Record evaluation evidence ids',
          rationale: 'Add bounded evidence guidance.',
          maxChangedBullets: 1,
          maxChangedTokens: 6,
        }),
      }) as never,
    });

    const proposal = await propose(proposeInput);

    expect(proposal).not.toBeNull();
    expect(proposal?.operation).toBe(SkillEvolutionPatchOperation.ADD);
    expect(proposal?.afterContent).toContain('Record evaluation evidence ids');
    expect(proposal?.budget.maxChangedBullets).toBe(1);
  });

  it('returns null when no LLM client is configured', async () => {
    const propose = createLlmSkillPatchProposer({
      providerFactory: fakeProviderFactory(null, false) as never,
    });

    const proposal = await propose(proposeInput);
    expect(proposal).toBeNull();
  });

  it('returns null on malformed model output', async () => {
    const propose = createLlmSkillPatchProposer({
      providerFactory: fakeProviderFactory({ content: 'not json at all' }) as never,
    });

    const proposal = await propose(proposeInput);
    expect(proposal).toBeNull();
  });

  it('returns null when required fields are missing', async () => {
    const propose = createLlmSkillPatchProposer({
      providerFactory: fakeProviderFactory({
        content: JSON.stringify({ operation: 'add' }),
      }) as never,
    });

    const proposal = await propose(proposeInput);
    expect(proposal).toBeNull();
  });
});
