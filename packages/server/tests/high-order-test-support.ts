import { Embedder } from '../src/processing/embedder.js';
import type { OpenAIClient } from '../src/openai-client.js';

/**
 * Build a fake ProviderFactory for high-order compressor tests.
 *
 * High-order compression now requires real (non-local) vectors AND an LLM, so
 * tests must supply both. The embedder is a real Embedder in online mode with
 * an injected embeddings client that maps content → a deterministic vector via
 * `vectorFor`, so callers control which nodes cluster. The chat client returns
 * `synthesis` (a JSON string) for every completion, standing in for LLM
 * generalization; pass `chatContent: null` to simulate "no synthesis".
 */
export function fakeHighOrderProviderFactory(opts: {
  vectorFor: (text: string) => number[];
  chatContent: string | null;
  llmClient?: boolean;
}): { forProject: () => unknown } {
  const embeddingsClient: OpenAIClient = {
    embeddings: {
      create: async ({ input }) => {
        const inputs = Array.isArray(input) ? input : [input];
        return { data: inputs.map((text, index) => ({ embedding: opts.vectorFor(text), index })) };
      },
    },
    chat: { completions: { create: async () => ({ choices: [] }) } },
  };
  const embedder = new Embedder('fake-key', 'fake-embed', undefined, { client: embeddingsClient });

  const llmClient: OpenAIClient | null = opts.llmClient === false ? null : {
    embeddings: { create: async () => ({ data: [] }) },
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: opts.chatContent } }] }),
      },
    },
  };

  return {
    forProject: () => ({
      embedder,
      llmModel: 'fake-model',
      embeddingModel: 'fake-embed',
      embeddingDim: 4,
      hasConfig: true,
      llmClientPromise: Promise.resolve(llmClient),
    }),
  };
}
