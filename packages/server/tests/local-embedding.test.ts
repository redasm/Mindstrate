import { describe, expect, it } from 'vitest';
import { Embedder } from '../src/processing/embedder.js';

const cosine = (a: number[], b: number[]): number =>
  a.reduce((sum, value, i) => sum + value * b[i], 0); // vectors are L2-normalized

describe('local (offline) embedding', () => {
  const embedder = new Embedder('');

  it('runs in local mode without an API key', () => {
    expect(embedder.isLocalMode()).toBe(true);
    expect(embedder.getEmbeddingDimension()).toBe(256);
  });

  it('captures lexical overlap between Chinese texts that share words but not whole phrases', async () => {
    const a = await embedder.embed('数据库连接失败的排查方法');
    const related = await embedder.embed('如何排查数据库连接问题');
    const unrelated = await embedder.embed('前端页面渲染性能优化');

    const relatedScore = cosine(a, related);
    const unrelatedScore = cosine(a, unrelated);

    // CJK runs are split into characters + character bigrams, so sharing
    // the words 数据库/连接/排查 must yield clearly higher similarity than
    // an unrelated sentence — with run-level tokenization both were ~0.
    expect(relatedScore).toBeGreaterThan(unrelatedScore);
    expect(relatedScore).toBeGreaterThan(0.3);
  });

  it('still captures overlap for latin word tokens', async () => {
    const a = await embedder.embed('fix database connection timeout');
    const related = await embedder.embed('database connection timeout troubleshooting');
    const unrelated = await embedder.embed('render frontend page faster');

    expect(cosine(a, related)).toBeGreaterThan(cosine(a, unrelated));
  });
});
