import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { ApiKeyRepository } from '../src/storage/api-key-repository.js';
import { DatabaseStore } from '../src/storage/database-store.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('ApiKeyRepository', () => {
  let tempDir: string;
  let databaseStore: DatabaseStore;
  let repo: ApiKeyRepository;

  beforeEach(() => {
    tempDir = createTempDir();
    databaseStore = new DatabaseStore(path.join(tempDir, 'test.db'));
    repo = new ApiKeyRepository(databaseStore.getDb());
  });

  afterEach(() => {
    databaseStore.close();
    removeTempDir(tempDir);
  });

  it('creates a key with a fresh hex value and round-trips it', () => {
    const created = repo.create({
      name: 'alice',
      scopes: ['read', 'write'],
      projects: ['proj-a'],
      createdBy: 'admin',
    });

    expect(created.id).toBeTruthy();
    expect(created.name).toBe('alice');
    expect(created.key).toMatch(/^[0-9a-f]{64}$/);
    expect(created.scopes).toEqual(['read', 'write']);
    expect(created.projects).toEqual(['proj-a']);
    expect(created.createdBy).toBe('admin');
    expect(created.revokedAt).toBeUndefined();

    const fetched = repo.findActiveByKey(created.key);
    expect(fetched?.id).toBe(created.id);
  });

  it('lists only active keys ordered newest-first', () => {
    const a = repo.create({ name: 'a', scopes: ['read'], projects: ['*'] });
    const b = repo.create({ name: 'b', scopes: ['read'], projects: ['*'] });
    repo.revoke(a.id);

    const active = repo.listActive();
    expect(active.map((entry) => entry.id)).toEqual([b.id]);
  });

  it('revoked keys are not returned by findActiveByKey', () => {
    const created = repo.create({ name: 'a', scopes: ['read'], projects: ['*'] });
    expect(repo.revoke(created.id)).toBe(true);
    expect(repo.findActiveByKey(created.key)).toBeNull();

    // Idempotent revoke: second call cannot revoke again
    expect(repo.revoke(created.id)).toBe(false);
  });

  it('getById returns both active and revoked records', () => {
    const created = repo.create({ name: 'a', scopes: ['read'], projects: ['*'] });
    repo.revoke(created.id);
    const fetched = repo.getById(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.revokedAt).toBeTruthy();
  });
});
