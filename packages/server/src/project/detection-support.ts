import * as fs from 'node:fs';

export const MAX_DEPS = 40;
export const README_EXCERPT_MAX = 600;

const FRAMEWORK_HINTS: Array<{ dep: string | RegExp; framework: string }> = [
  { dep: 'next', framework: 'next.js' },
  { dep: 'nuxt', framework: 'nuxt' },
  { dep: '@nestjs/core', framework: 'nestjs' },
  { dep: 'react', framework: 'react' },
  { dep: 'vue', framework: 'vue' },
  { dep: '@angular/core', framework: 'angular' },
  { dep: 'svelte', framework: 'svelte' },
  { dep: 'express', framework: 'express' },
  { dep: 'fastify', framework: 'fastify' },
  { dep: 'koa', framework: 'koa' },
  { dep: 'hono', framework: 'hono' },
  { dep: 'electron', framework: 'electron' },
  { dep: 'react-native', framework: 'react-native' },
  { dep: 'django', framework: 'django' },
  { dep: 'flask', framework: 'flask' },
  { dep: 'fastapi', framework: 'fastapi' },
  { dep: 'rails', framework: 'rails' },
  { dep: 'spring-boot', framework: 'spring-boot' },
  { dep: /(^|\/)gin(-gonic)?(\/gin)?$/, framework: 'gin' },
  { dep: /(^|\/)echo$/, framework: 'echo' },
  { dep: /^actix(-web)?$/, framework: 'actix' },
  { dep: 'rocket', framework: 'rocket' },
  { dep: /^axum$/, framework: 'axum' },
];

export const pickFramework = (depNames: string[]): string | undefined => {
  for (const hint of FRAMEWORK_HINTS) {
    for (const dep of depNames) {
      if (typeof hint.dep === 'string' ? dep === hint.dep : hint.dep.test(dep)) {
        return hint.framework;
      }
    }
  }
  return undefined;
};

export const safeJson = (filePath: string): any | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

export const safeRead = (filePath: string): string | null => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
};

export const scalarFromToml = (text: string, key: string): string | undefined => {
  const re = new RegExp(`^${escapeRe(key)}\\s*=\\s*"([^"\\n]+)"`, 'm');
  const match = text.match(re);
  return match?.[1];
};

export const depsFromTomlBlock = (text: string, blockName: string): string[] => {
  const out: string[] = [];
  const headerRe = new RegExp(
    `^\\[(?:[^\\]\\n]*\\.)?${escapeRe(blockName)}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n\\[|$)`,
    'gm',
  );

  for (const match of text.matchAll(headerRe)) {
    const body = match[1] ?? '';
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const depMatch = trimmed.match(/^([a-zA-Z0-9_.\-]+)\s*=/);
      if (depMatch) out.push(depMatch[1]);
    }
  }

  const listRe = new RegExp(`^${escapeRe(blockName)}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm');
  const listMatch = text.match(listRe);
  if (listMatch) {
    for (const match of listMatch[1].matchAll(/"([^"]+)"/g)) {
      const dep = match[1].split(/[<>=!~ ]/)[0].trim();
      if (dep) out.push(dep);
    }
  }

  return out;
};

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
