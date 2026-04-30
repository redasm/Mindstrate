import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectProject, findProjectRoot } from '../src/project/detector.js';
import { createTempDir, removeTempDir } from './test-support.js';

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

describe('detectProject', () => {
  let root: string;

  beforeEach(() => {
    root = createTempDir('mindstrate-detect-');
  });

  afterEach(() => {
    removeTempDir(root);
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
    expect(p.detectionRule?.id).toBe('nextjs-project');
    expect(p.snapshotHints?.overview).toContain('Next.js');
  });

  it('detects React, Vue, and Vite projects from built-in JSON rules', () => {
    write(root, 'package.json', JSON.stringify({
      name: 'react-app',
      scripts: { dev: 'vite --host 0.0.0.0' },
      dependencies: { react: '^19.0.0' },
      devDependencies: { vite: '^6.0.0' },
    }));
    write(root, 'src/main.tsx', 'import React from "react";');

    const reactProject = detectProject(root)!;
    expect(reactProject.name).toBe('react-app');
    expect(reactProject.framework).toBe('react');
    expect(reactProject.detectionRule?.id).toBe('react-project');
    expect(reactProject.scripts.dev).toBe('vite --host 0.0.0.0');
    expect(reactProject.dependencies.find((d) => d.name === 'vite')?.kind).toBe('dev');
    expect(reactProject.entryPoints).toContain('src/main.tsx');
    expect(reactProject.graphHints?.parserAdapters).toContain('tree-sitter-source');
    expect(reactProject.graphHints?.queryPacks).toEqual(expect.arrayContaining(['typescript', 'tsx', 'react']));
    expect(reactProject.graphHints?.conventionExtractors).toContain('react-components');
    expect(reactProject.graphHints?.sourceRoots).toContain('src');

    removeTempDir(root);
    root = createTempDir('mindstrate-detect-');
    write(root, 'package.json', JSON.stringify({
      name: 'vue-app',
      dependencies: { vue: '^3.0.0' },
      devDependencies: { vite: '^6.0.0' },
    }));
    write(root, 'src/App.vue', '<template />');

    const vueProject = detectProject(root)!;
    expect(vueProject.framework).toBe('vue');
    expect(vueProject.detectionRule?.id).toBe('vue-project');
    expect(vueProject.entryPoints).toContain('src/App.vue');
    expect(vueProject.graphHints?.parserAdapters).toEqual(expect.arrayContaining(['vue-sfc', 'tree-sitter-source']));
    expect(vueProject.graphHints?.queryPacks).toContain('vue');

    removeTempDir(root);
    root = createTempDir('mindstrate-detect-');
    write(root, 'package.json', JSON.stringify({
      name: 'plain-vite-app',
      devDependencies: { vite: '^6.0.0' },
    }));
    write(root, 'index.html', '<div id="app"></div>');

    const viteProject = detectProject(root)!;
    expect(viteProject.framework).toBe('vite');
    expect(viteProject.detectionRule?.id).toBe('vite-project');
    expect(viteProject.entryPoints).toContain('index.html');
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

  it('detects an Unreal project from built-in project detection rules', () => {
    write(root, 'Client.uproject', JSON.stringify({ FileVersion: 3 }));
    fs.mkdirSync(path.join(root, 'Content'));
    fs.mkdirSync(path.join(root, 'Config'));
    fs.mkdirSync(path.join(root, 'Source', 'Client'), { recursive: true });
    write(root, 'Source/Client/Client.Build.cs', 'public class Client {}');

    const p = detectProject(root)!;
    expect(p.name).toBe('Client');
    expect(p.language).toBe('cpp');
    expect(p.framework).toBe('unreal-engine');
    expect(p.packageManager).toBe('unreal');
    expect(p.manifestPath).toBe('Client.uproject');
    expect(p.entryPoints).toContain('Source/Client/Client.Build.cs');
    expect(p.detectionRule?.id).toBe('unreal-project');
    expect(p.topDirDescriptions?.['Intermediate']).toContain('Generated build intermediates');
    expect(p.snapshotHints?.invariants).toContain('Do not edit Binaries, Intermediate, Saved, or DerivedDataCache unless explicitly requested.');
    expect(p.graphHints?.parserAdapters).toEqual(expect.arrayContaining(['unreal-manifest', 'unreal-build', 'unreal-config']));
    expect(p.graphHints?.queryPacks).toEqual(expect.arrayContaining(['cpp-light', 'csharp-build-light']));
    expect(p.graphHints?.generatedRoots).toEqual(expect.arrayContaining([
      'Binaries',
      'Intermediate',
      'Saved',
      'DerivedDataCache',
      'TypeScript/Typing/ue/generated',
    ]));
    expect(p.graphHints?.layers?.map((layer) => layer.id)).toEqual(expect.arrayContaining(['gameplay-cpp', 'content-assets', 'config', 'generated']));
  });

  it('loads project-local detection rules before built-ins', () => {
    write(root, '.mindstrate/rules/custom-engine.json', JSON.stringify({
      id: 'custom-engine',
      name: 'Custom Engine',
      priority: 200,
      match: { all: [{ dir: 'GameSource' }] },
      detect: {
        language: 'cpp',
        framework: 'custom-engine',
        manifest: 'Game.project',
        entryPoints: ['GameSource/Main.cpp'],
        topDirs: {
          GameSource: 'Custom engine source code.',
        },
      },
      snapshot: {
        overview: 'This is a custom engine project.',
        invariants: ['Do not edit generated custom-engine output.'],
      },
      parserAdapters: ['tree-sitter-source'],
      queryPacks: ['cpp-light'],
      sourceRoots: ['GameSource'],
      generatedRoots: ['Generated'],
      riskHints: ['Generated output is not source.'],
    }));
    fs.mkdirSync(path.join(root, 'GameSource'), { recursive: true });
    write(root, 'GameSource/Main.cpp', 'int main() { return 0; }');
    write(root, 'Game.project', '{}');

    const p = detectProject(root)!;
    expect(p.framework).toBe('custom-engine');
    expect(p.detectionRule?.source).toBe('project');
    expect(p.snapshotHints?.overview).toBe('This is a custom engine project.');
    expect(p.graphHints?.sourceRoots).toEqual(['GameSource']);
    expect(p.graphHints?.riskHints).toEqual(['Generated output is not source.']);
  });

  it('ignores invalid project-local detection rule files', () => {
    write(root, '.mindstrate/rules/bad.json', JSON.stringify({
      name: 'Missing id',
      match: { all: [{ dir: 'src' }] },
    }));
    fs.mkdirSync(path.join(root, 'src'));

    const p = detectProject(root)!;
    expect(p.detectionRule).toBeUndefined();
    expect(p.topDirs).toContain('src');
  });

  it('supports declarative rule operators without leaving the project root', () => {
    write(root, '.mindstrate/rules/web-tool.json', JSON.stringify({
      id: 'web-tool',
      name: 'Web Tool',
      priority: 200,
      match: {
        all: [
          { file: 'package.json', jsonPath: 'scripts.build' },
          { packageDependency: 'vite' },
          { file: 'Project.toml', tomlKey: 'tool.mindstrate' },
        ],
        none: [
          { file: '../outside.txt' },
        ],
      },
      detect: {
        language: 'typescript',
        framework: 'vite-tool',
      },
    }));
    write(root, 'package.json', JSON.stringify({
      scripts: { build: 'vite build' },
      devDependencies: { vite: '^6.0.0' },
    }));
    write(root, 'Project.toml', '[tool]\nmindstrate = true\n');

    const p = detectProject(root)!;
    expect(p.framework).toBe('vite-tool');
    expect(p.detectionRule?.id).toBe('web-tool');
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
