/**
 * LLM synthesis for mid-tier substrate compression
 * (SNAPSHOT → SUMMARY → PATTERN → RULE).
 *
 * Without an LLM these compressors could only template-concatenate the source
 * titles ("Generalized from N similar session patterns" + a numbered list),
 * which reads as noise: unrelated session items get fused into one "rule" whose
 * body restates the sources instead of stating a reusable principle. This
 * helper asks the model to actually synthesize:
 *
 *  - cluster of >= 2: find the shared principle that unifies the items and
 *    write ONE generalized node — or return null if they are not genuinely
 *    related, so the caller skips the cluster rather than fabricating a rule.
 *  - cluster of 1 (a high-feedback singleton promotion): refine that single
 *    node's content into a crisp statement at the target tier. There is no
 *    relatedness to judge, so it never returns null for shape — only on a
 *    transport/parse failure.
 *
 * Returning null always means "skip — do not write a placeholder".
 */

import type { ContextNode, SubstrateType } from '@mindstrate/protocol/models';
import type { OpenAIClient } from '../openai-client.js';
import { contentLanguageInstruction } from '../content-locale.js';

export interface CompressionSynthesis {
  title: string;
  content: string;
}

export interface SynthesizeCompressedInput {
  client: OpenAIClient;
  model: string;
  targetType: SubstrateType;
  cluster: ContextNode[];
}

/** Cap per-source body sent to the model so a big cluster stays under body limits. */
const MAX_SOURCE_CONTENT_CHARS = 1200;

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

export const synthesizeCompressedNode = async (
  input: SynthesizeCompressedInput,
): Promise<CompressionSynthesis | null> =>
  input.cluster.length === 1
    ? refineSingle(input)
    : synthesizeCluster(input);

const synthesizeCluster = async (
  input: SynthesizeCompressedInput,
): Promise<CompressionSynthesis | null> => {
  const sources = input.cluster.map((node, index) => ({
    index: index + 1,
    title: node.title,
    content: truncate(node.content, MAX_SOURCE_CONTENT_CHARS),
  }));

  try {
    const response = await input.client.chat.completions.create({
      model: input.model,
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            `You compress ${sources.length} related knowledge items into ONE reusable ${input.targetType}.`,
            contentLanguageInstruction(),
            'Find the shared, reusable principle that actually unifies them.',
            'If they are NOT genuinely related (no real common principle), return {"related":false}.',
            'Otherwise return {"related":true,"title":"concise title","content":"the reusable knowledge: what it is, when it applies, why"}.',
            'Do not just list the source items; synthesize a single coherent statement.',
          ].join(' '),
        },
        { role: 'user', content: JSON.stringify({ sources }) },
      ],
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { related?: boolean; title?: unknown; content?: unknown };
    if (parsed.related === false) return null;
    return toSynthesis(parsed);
  } catch {
    return null;
  }
};

const refineSingle = async (
  input: SynthesizeCompressedInput,
): Promise<CompressionSynthesis | null> => {
  const node = input.cluster[0];

  try {
    const response = await input.client.chat.completions.create({
      model: input.model,
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            `You rewrite one validated knowledge item into a crisp, reusable ${input.targetType}.`,
            contentLanguageInstruction(),
            'State the reusable principle directly: what it is, when it applies, and why.',
            'Do not invent facts beyond the source; do not restate boilerplate like "generalized from N items".',
            'Return {"title":"concise title","content":"the reusable knowledge"}.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            title: node.title,
            content: truncate(node.content, MAX_SOURCE_CONTENT_CHARS),
          }),
        },
      ],
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) return null;
    return toSynthesis(JSON.parse(raw) as { title?: unknown; content?: unknown });
  } catch {
    return null;
  }
};

const toSynthesis = (parsed: { title?: unknown; content?: unknown }): CompressionSynthesis | null => {
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const content = typeof parsed.content === 'string' ? parsed.content.trim() : '';
  if (!title || !content) return null;
  return { title, content };
};
