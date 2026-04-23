// @ts-check
/**
 * Repository-wide ESLint config — flat config for ESLint v9.
 *
 * Enforces architectural boundaries between the 4 package layers:
 *   protocol  →  client  →  mcp-server
 *           ↘  server  →  team-server, cli, web-ui, obsidian-sync
 *
 * The most expensive lessons from the v0.2 refactor:
 *   - Importing the @mindstrate/server barrel from the MCP server
 *     drags in better-sqlite3 (a native module), breaking team-only
 *     installs that don't have the C++ toolchain.
 *   - Re-export barrels are silent eager loaders.
 *
 * The rules below make those mistakes loud at lint time, not at
 * "team member can't install" time.
 */

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

const ignores = [
  '**/dist/**',
  '**/bundle/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/node_modules/**',
  '**/install/.stage/**',
  '**/install/dist/**',
  '**/*.config.js',
  '**/*.config.mjs',
  '**/*.config.ts',
  'eslint.config.mjs',
];

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores },

  // ------------ Base TS rules for every source file ------------
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ------------ Layer guard: mcp-server may NEVER statically import server ------------
  {
    files: ['packages/mcp-server/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@mindstrate/server',
            message:
              'Do NOT statically import @mindstrate/server from mcp-server. ' +
              'It depends on better-sqlite3 (native module), unavailable in team-only ' +
              'distributions. Use `await import("@mindstrate/server")` inside init() ' +
              'when local mode is enabled.',
          },
          {
            name: '@mindstrate/obsidian-sync',
            message:
              'Same reason as @mindstrate/server: load it via dynamic import inside ' +
              'the local-mode branch only.',
          },
        ],
      }],
    },
  },

  // ------------ Layer guard: protocol must stay pure ------------
  {
    files: ['packages/protocol/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: [
              '@mindstrate/server',
              '@mindstrate/client',
              '@mindstrate/team-server',
              '@mindstrate/mcp-server',
              '@mindstrate/cli',
              '@mindstrate/web-ui',
              '@mindstrate/obsidian-sync',
              'better-sqlite3',
              'openai',
              'express',
            ],
            message:
              'protocol must remain a pure type-only package. ' +
              'No runtime dependencies allowed.',
          },
        ],
      }],
    },
  },

  // ------------ Layer guard: client only depends on protocol + standard lib ------------
  {
    files: ['packages/client/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: [
              '@mindstrate/server',
              '@mindstrate/team-server',
              '@mindstrate/mcp-server',
              '@mindstrate/cli',
              '@mindstrate/web-ui',
              '@mindstrate/obsidian-sync',
              'better-sqlite3',
              'openai',
              'express',
            ],
            message:
              'client may only depend on @mindstrate/protocol and Node built-ins. ' +
              'It must stay free of native modules so it can run anywhere.',
          },
        ],
      }],
    },
  },
];
