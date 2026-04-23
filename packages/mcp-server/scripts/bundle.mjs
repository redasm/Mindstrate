#!/usr/bin/env node
/**
 * Bundle the MCP Server into a single self-contained JS file.
 *
 * - Inlines @mindstrate/protocol and @mindstrate/client (they're
 *   small, type/HTTP-only, and we want the bundle to be 100% portable).
 * - Marks @mindstrate/server and @mindstrate/obsidian-sync as
 *   external — they're optional peers, dynamically imported only in
 *   local mode. Most users never see them.
 * - Marks all node built-ins external (esbuild does this automatically
 *   when --platform=node is set).
 * - Marks pino transport workers external (they need to spawn).
 *
 * Output: bundle/mindstrate-mcp.js  (~150 KB, gzip ~40 KB)
 */

import { build } from 'esbuild';
import { writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outFile = resolve(root, 'bundle', 'mindstrate-mcp.js');

mkdirSync(dirname(outFile), { recursive: true });

const result = await build({
  entryPoints: [resolve(root, 'src/server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: outFile,
  banner: {
    js: '// @mindstrate/mcp-server — bundled with esbuild',
  },
  // Optional peers loaded via dynamic import in local mode only.
  external: [
    '@mindstrate/server',
    '@mindstrate/obsidian-sync',
  ],
  minify: false,
  sourcemap: false,
  metafile: true,
  logLevel: 'info',
});

// Make the bundle executable on Unix.
try { chmodSync(outFile, 0o755); } catch { /* Windows */ }

// Quick size report.
const size = result.metafile ? Object.values(result.metafile.outputs)[0].bytes : 0;
console.log(`\n  bundle:  ${outFile}`);
console.log(`  size:    ${(size / 1024).toFixed(1)} KB`);
