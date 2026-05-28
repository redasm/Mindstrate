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

  it('defaults role to member and respects an explicit admin role', () => {
    const member = repo.create({ name: 'm', scopes: ['read'], projects: ['*'] });
    const admin = repo.create({ name: 'a', scopes: ['admin'], projects: ['*'], role: 'admin' });
    expect(member.role).toBe('member');
    expect(admin.role).toBe('admin');
  });

  it('findByNameAndKey requires both fields to match an active record', () => {
    const created = repo.create({ name: 'alice', scopes: ['read'], projects: ['*'] });
    expect(repo.findByNameAndKey('alice', created.key)?.id).toBe(created.id);
    expect(repo.findByNameAndKey('bob', created.key)).toBeNull();
    expect(repo.findByNameAndKey('alice', 'wrong')).toBeNull();
    repo.revoke(created.id);
    expect(repo.findByNameAndKey('alice', created.key)).toBeNull();
  });

  it('setRole / setProjects / setEnabled / regenerateKey / deleteHard work as labelled', () => {
    const k = repo.create({ name: 'k', scopes: ['read'], projects: ['p1'] });
    expect(repo.setRole(k.id, 'admin')).toBe(true);
    expect(repo.getById(k.id)?.role).toBe('admin');
    expect(repo.setProjects(k.id, ['p1', 'p2'])).toBe(true);
    expect(repo.getById(k.id)?.projects).toEqual(['p1', 'p2']);
    expect(repo.setEnabled(k.id, false)).toBe(true);
    expect(repo.getById(k.id)?.revokedAt).toBeTruthy();
    expect(repo.setEnabled(k.id, true)).toBe(true);
    expect(repo.getById(k.id)?.revokedAt).toBeFalsy();
    const regen = repo.regenerateKey(k.id);
    expect(regen?.newKey).toMatch(/^[0-9a-f]{64}$/);
    expect(regen?.newKey).not.toBe(k.key);
    expect(repo.deleteHard(k.id)).toBe(true);
    expect(repo.getById(k.id)).toBeNull();
  });

  it('countAdmins counts only active admins', () => {
    repo.create({ name: 'm1', scopes: ['read'], projects: ['*'], role: 'member' });
    const a1 = repo.create({ name: 'a1', scopes: ['admin'], projects: ['*'], role: 'admin' });
    repo.create({ name: 'a2', scopes: ['admin'], projects: ['*'], role: 'admin' });
    expect(repo.countAdmins()).toBe(2);
    repo.revoke(a1.id);
    expect(repo.countAdmins()).toBe(1);
  });

  it('honours an explicit key (used for TEAM_API_KEY bootstrap)', () => {
    const created = repo.create({
      name: 'admin', scopes: ['admin'], projects: ['*'], role: 'admin', key: 'sentinel-key',
    });
    expect(created.key).toBe('sentinel-key');
    expect(repo.findByNameAndKey('admin', 'sentinel-key')?.id).toBe(created.id);
  });
});
