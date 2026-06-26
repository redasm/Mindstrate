/**
 * LLM synthesis for high-order substrate compression.
 *
 * The high-order compressor clusters similar lower-tier nodes (RULE → SKILL →
 * HEURISTIC → AXIOM). Without an LLM it can only template-concatenate the
 * source titles, which produces empty "Generalized X from N nodes" shells that
 * read as noise. This helper asks the model to actually generalize a cluster
 * into one higher-order node — a real title + body that states the shared
 * principle — or returns null so the caller skips the cluster rather than
 * writing a placeholder.
 */

import type { ContextNode, SubstrateType } from '@mindstrate/protocol/models';
import type { OpenAIClient } from '../openai-client.js';
import { contentLanguageInstruction } from '../content-locale.js';

export interface HighOrderSynthesis {
  title: string;
  content: string;
}

export interface SynthesizeHighOrderInput {
  client: OpenAIClient;
  model: string;
  targetType: SubstrateType;
  cluster: ContextNode[];
}

/** Cap per-source body sent to the model so a big cluster stays under body limits. */
const MAX_SOURCE_CONTENT_CHARS = 1200;

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

export const synthesizeHighOrderNode = async (
  input: SynthesizeHighOrderInput,
): Promise<HighOrderSynthesis | null> => {
  const sources = input.cluster.map((node, index) => ({
    index: index + 1,
    title: node.title,
    content: truncate(node.content, MAX_SOURCE_CONTENT_CHARS),
  }));

  try {
    const response = await input.client.chat.completions.create({
      model: input.model,
      temperature: 0.2,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            `You generalize related ${sources.length} knowledge items into ONE higher-order ${input.targetType}.`,
            contentLanguageInstruction(),
            'Find the shared principle/skill that actually unifies them.',
            'If they are NOT genuinely related (no real common principle), return {"related":false}.',
            'Otherwise return {"related":true,"title":"concise title","content":"the generalized knowledge: what it is, when it applies, why"}.',
            'Do not just list the source items; synthesize.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({ sources }),
        },
      ],
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { related?: boolean; title?: unknown; content?: unknown };
    // The model judged the cluster spurious — skip it rather than synthesize.
    if (parsed.related === false) return null;
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const content = typeof parsed.content === 'string' ? parsed.content.trim() : '';
    if (!title || !content) return null;
    return { title, content };
  } catch {
    // Transport/parse failure: skip this cluster (no placeholder) rather than throw.
    return null;
  }
};
