/**
 * mindstrate hook - 管理 git post-commit hook
 *
 * 安装/卸载自动知识采集的 git hook。
 */

import { Command } from 'commander';
import * as path from 'node:path';
import {
  installGitHook,
  uninstallGitHook,
  getGitRoot,
} from '@mindstrate/server';

export const hookCommand = new Command('hook')
  .description('Manage git post-commit hook for auto-capture');

hookCommand
  .command('install')
  .description('Install post-commit hook for automatic knowledge capture')
  .action(async () => {
    const gitRoot = getGitRoot();
    if (!gitRoot) {
      console.error('Error: Not a git repository.');
      process.exit(1);
    }

    // 找到 CLI 入口路径
    const cliPath = path.resolve(__dirname, '../index.js');

    const success = installGitHook(process.cwd(), cliPath);

    if (success) {
      console.log('Git post-commit hook installed successfully!\n');
      console.log('What happens now:');
      console.log('  - Every time you make a commit, Mindstrate will analyze it');
      console.log('  - Valuable knowledge will be automatically extracted and stored');
      console.log('  - The hook runs silently and won\'t block your commits');
      console.log(`\nGit root: ${gitRoot}`);
    } else {
      console.error('Failed to install git hook.');
      process.exit(1);
    }
  });

hookCommand
  .command('uninstall')
  .description('Remove the post-commit hook')
  .action(async () => {
    const success = uninstallGitHook();

    if (success) {
      console.log('Git post-commit hook removed.');
    } else {
      console.error('Failed to remove git hook.');
      process.exit(1);
    }
  });
