/**
 * mindstrate web - 启动 Web UI 管理界面
 */

import { Command } from 'commander';
import { execSync, spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

export const webCommand = new Command('web')
  .description('Start the Web UI management interface')
  .option('-p, --port <port>', 'Port number', '3377')
  .option('--dev', 'Start in development mode', false)
  .action(async (options) => {
    const webUiDir = findWebUiDir();
    if (!webUiDir) {
      console.error('Error: Cannot find @mindstrate/web-ui package.');
      console.error('Make sure the web-ui package is installed and built.');
      process.exit(1);
    }

    const port = options.port;
    const mode = options.dev ? 'dev' : 'start';

    // 检查是否已构建
    if (!options.dev) {
      const nextDir = path.join(webUiDir, '.next');
      if (!fs.existsSync(nextDir)) {
        console.log('Web UI not built yet. Building...');
        try {
          execSync('npx next build', { cwd: webUiDir, stdio: 'inherit' });
        } catch {
          console.error('Build failed. Try running in dev mode: mindstrate web --dev');
          process.exit(1);
        }
      }
    }

    console.log(`Starting Mindstrate Web UI on http://localhost:${port}`);
    console.log('Press Ctrl+C to stop.\n');

    const child = spawn('npx', ['next', mode, '-p', port], {
      cwd: webUiDir,
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        PORT: port,
      },
    });

    child.on('error', (err) => {
      console.error('Failed to start Web UI:', err.message);
      process.exit(1);
    });

    child.on('exit', (code) => {
      process.exit(code ?? 1);
    });
  });

function findWebUiDir(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../web-ui'),
    path.resolve(process.cwd(), 'packages/web-ui'),
    path.resolve(process.cwd(), 'node_modules/@mindstrate/web-ui'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'package.json'))) return c;
  }
  return null;
}
