import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { DatabaseStore } from '../src/storage/database-store.js';
import { LlmConfigRepository } from '../src/storage/llm-config-repository.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('LlmConfigRepository embeddingApiKey', () => {
  let tempDir: string;
  let databaseStore: DatabaseStore;
  let repo: LlmConfigRepository;

  beforeEach(() => {
    tempDir = createTempDir();
    databaseStore = new DatabaseStore(path.join(tempDir, 'test.db'));
    repo = new LlmConfigRepository(databaseStore.getDb());
  });

  afterEach(() => {
    databaseStore.close();
    removeTempDir(tempDir);
  });

  it('persists a separate embedding api key', () => {
    const created = repo.create({
      project: 'p',
      openaiApiKey: 'llm-key',
      embeddingApiKey: 'embed-key',
      llmModel: 'm',
      embeddingModel: 'e',
      embeddingDim: 1024,
    });
    expect(created.embeddingApiKey).toBe('embed-key');
    expect(repo.getByProject('p')?.embeddingApiKey).toBe('embed-key');
  });

  it('defaults embeddingApiKey to undefined when omitted', () => {
    const created = repo.create({
      project: 'p2',
      openaiApiKey: 'llm-key',
      llmModel: 'm',
      embeddingModel: 'e',
      embeddingDim: 1024,
    });
    expect(created.embeddingApiKey).toBeUndefined();
  });

  it('clears embeddingApiKey when updated to null', () => {
    const created = repo.create({
      project: 'p3',
      openaiApiKey: 'llm-key',
      embeddingApiKey: 'embed-key',
      llmModel: 'm',
      embeddingModel: 'e',
      embeddingDim: 1024,
    });
    const updated = repo.update(created.id, { embeddingApiKey: null });
    expect(updated?.embeddingApiKey).toBeUndefined();
  });
});
