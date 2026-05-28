import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL = process.env.MINDSTRATE_PROJECTS;

const loadGuard = async () => import('../src/allowed-projects.js');

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MINDSTRATE_PROJECTS;
  else process.env.MINDSTRATE_PROJECTS = ORIGINAL;
  vi.resetModules();
});

describe('assertProjectAllowed', () => {
  it('treats unset MINDSTRATE_PROJECTS as wildcard', async () => {
    delete process.env.MINDSTRATE_PROJECTS;
    const { assertProjectAllowed, isWildcard } = await loadGuard();
    expect(isWildcard()).toBe(true);
    expect(() => assertProjectAllowed('anything')).not.toThrow();
  });

  it('treats "*" as wildcard', async () => {
    process.env.MINDSTRATE_PROJECTS = '*';
    const { assertProjectAllowed, isWildcard } = await loadGuard();
    expect(isWildcard()).toBe(true);
    expect(() => assertProjectAllowed('anything')).not.toThrow();
  });

  it('passes through undefined and empty project unchanged', async () => {
    process.env.MINDSTRATE_PROJECTS = 'proj-a';
    const { assertProjectAllowed } = await loadGuard();
    expect(() => assertProjectAllowed(undefined)).not.toThrow();
    expect(() => assertProjectAllowed('')).not.toThrow();
  });

  it('accepts projects in the allow-list', async () => {
    process.env.MINDSTRATE_PROJECTS = 'proj-a,proj-b';
    const { assertProjectAllowed } = await loadGuard();
    expect(() => assertProjectAllowed('proj-a')).not.toThrow();
    expect(() => assertProjectAllowed('proj-b')).not.toThrow();
  });

  it('rejects projects outside the allow-list with a structured error', async () => {
    process.env.MINDSTRATE_PROJECTS = 'proj-a,proj-b';
    const { assertProjectAllowed, ProjectNotAllowedError } = await loadGuard();
    expect(() => assertProjectAllowed('proj-c')).toThrow(ProjectNotAllowedError);
    expect(() => assertProjectAllowed('proj-c')).toThrow(/proj-a, proj-b/);
  });

  it('trims whitespace around each entry', async () => {
    process.env.MINDSTRATE_PROJECTS = '  proj-a , proj-b  ';
    const { assertProjectAllowed } = await loadGuard();
    expect(() => assertProjectAllowed('proj-a')).not.toThrow();
    expect(() => assertProjectAllowed('proj-b')).not.toThrow();
  });

  it('listAllowedProjects returns null for wildcard, array for scoped', async () => {
    process.env.MINDSTRATE_PROJECTS = '*';
    const wildcard = await loadGuard();
    expect(wildcard.listAllowedProjects()).toBeNull();

    vi.resetModules();
    process.env.MINDSTRATE_PROJECTS = 'proj-a,proj-b';
    const scoped = await loadGuard();
    expect(scoped.listAllowedProjects()).toEqual(['proj-a', 'proj-b']);
  });
});
