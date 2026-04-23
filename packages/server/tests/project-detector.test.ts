import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectProject, findProjectRoot } from '../src/project/detector.js';

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

describe('detectProject', () => {
  let root: string;

  beforeEach(() => {
    root = tmp('mindstrate-detect-');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns null for an empty unrelated directory (still falls back to generic)', () => {
    const detected = detectProject(root);
    expect(detected).not.toBeNull();
    expect(detected!.name).toBe(path.basename(root));
    expect(detected!.dependencies).toHaveLength(0);
    expect(detected!.language).toBeUndefined();
  });

  it('detects a Node + TypeScript + React project from package.json', () => {
    write(root, 'package.json', JSON.stringify({
      name: 'my-app',
      version: '1.2.3',
      description: 'demo',
      scripts: { build: 'tsc', test: 'vitest run' },
      dependencies: { react: '^18.0.0', next: '^15.0.0' },
      devDependencies: { typescript: '^5.0.0', vitest: '^4.0.0' },
      engines: { node: '>=18' },
    }));
    write(root, 'tsconfig.json', '{}');
    write(root, 'src/index.ts', 'export {}');

    const p = detectProject(root)!;
    expect(p.name).toBe('my-app');
    expect(p.version).toBe('1.2.3');
    expect(p.language).toBe('typescript');
    expect(p.framework).toBe('next.js');     // next has higher precedence than react
    expect(p.runtime).toMatch(/^node@/);
    expect(p.packageManager).toBe('npm');
    expect(p.scripts.build).toBe('tsc');
    expect(p.entryPoints).toContain('src/index.ts');
    expect(p.dependencies.find((d) => d.name === 'react')?.kind).toBe('prod');
    expect(p.dependencies.find((d) => d.name === 'typescript')?.kind).toBe('dev');
  });

  it('detects pnpm via lockfile', () => {
    write(root, 'package.json', JSON.stringify({ name: 'x' }));
    write(root, 'pnpm-lock.yaml', '');
    expect(detectProject(root)!.packageManager).toBe('pnpm');
  });

  it('detects a Python project from requirements.txt', () => {
    write(root, 'requirements.txt', 'fastapi>=0.100\nuvicorn[standard]==0.22.0\n# comment\n');
    write(root, 'app.py', '# entry');
    const p = detectProject(root)!;
    expect(p.language).toBe('python');
    expect(p.packageManager).toBe('pip');
    expect(p.framework).toBe('fastapi');
    expect(p.entryPoints).toContain('app.py');
    expect(p.dependencies.find((d) => d.name === 'fastapi')).toBeDefined();
  });

  it('detects a Rust project from Cargo.toml', () => {
    write(root, 'Cargo.toml', '[package]\nname = "neat-cli"\nversion = "0.1.0"\n[dependencies]\nactix-web = "4"\n');
    write(root, 'src/main.rs', 'fn main(){}');
    const p = detectProject(root)!;
    expect(p.language).toBe('rust');
    expect(p.framework).toBe('actix');
    expect(p.entryPoints).toContain('src/main.rs');
    expect(p.dependencies.find((d) => d.name === 'actix-web')).toBeDefined();
  });

  it('detects a Go project from go.mod', () => {
    write(root, 'go.mod', 'module example.com/svc\n\ngo 1.22\n\nrequire (\n  github.com/gin-gonic/gin v1.10.0\n)\n');
    write(root, 'main.go', 'package main; func main(){}');
    const p = detectProject(root)!;
    expect(p.language).toBe('go');
    expect(p.runtime).toBe('go@1.22');
    expect(p.framework).toBe('gin');
    expect(p.entryPoints).toContain('main.go');
  });

  it('truncates large dependency lists and reports overflow', () => {
    const deps: Record<string, string> = {};
    for (let i = 0; i < 60; i++) deps[`dep-${i}`] = '1.0.0';
    write(root, 'package.json', JSON.stringify({ name: 'big', dependencies: deps }));
    const p = detectProject(root)!;
    expect(p.dependencies.length).toBe(40);
    expect(p.truncatedDeps).toBe(20);
  });

  it('lists top-level directories ignoring noise', () => {
    write(root, 'package.json', JSON.stringify({ name: 'x' }));
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'tests'));
    fs.mkdirSync(path.join(root, 'node_modules', 'react'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist'));
    fs.mkdirSync(path.join(root, '.cache'));
    const p = detectProject(root)!;
    expect(p.topDirs).toEqual(['src', 'tests']);
  });

  it('captures a README excerpt', () => {
    write(root, 'package.json', JSON.stringify({ name: 'x' }));
    write(root, 'README.md', '# Title\n\nFirst para text.\n\nSecond para.');
    const p = detectProject(root)!;
    expect(p.readmeExcerpt).toBe('First para text.');
  });

  it('walks upward from a subdirectory to the project root', () => {
    write(root, 'package.json', JSON.stringify({ name: 'x' }));
    fs.mkdirSync(path.join(root, 'a/b/c'), { recursive: true });
    expect(findProjectRoot(path.join(root, 'a/b/c'))).toBe(root);
    const p = detectProject(path.join(root, 'a/b/c'))!;
    expect(p.root).toBe(root);
  });
});
