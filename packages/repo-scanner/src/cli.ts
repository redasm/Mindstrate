#!/usr/bin/env node
import { RepoScannerService } from './scanner-service.js';
import { RepoScannerDaemon } from './scheduler.js';

function value(flag: string, args: string[], fallback?: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  return args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const service = new RepoScannerService();
  await service.init();

  try {
    const [command, subcommand] = args;

    if (command === 'source' && subcommand === 'add-git') {
      const name = value('--name', args);
      const project = value('--project', args);
      const repoPath = value('--repo-path', args);
      if (!name || !project || !repoPath) {
        throw new Error('Usage: mindstrate-scan source add-git --name <name> --project <project> --repo-path <path>');
      }
      const source = service.addGitLocalSource({
        name,
        project,
        repoPath,
        branch: value('--branch', args),
        intervalSec: Number(value('--interval-sec', args, '300')),
        initMode: (value('--init-mode', args, 'from_now') as 'from_now' | 'backfill_recent'),
        backfillCount: Number(value('--backfill-count', args, '10')),
      });
      console.log(`Added source ${source.id} (${source.name})`);
      return;
    }

    if (command === 'source' && subcommand === 'list') {
      for (const source of service.listSources()) {
        console.log(`${source.id}  ${source.name}  ${source.project}  cursor=${source.lastCursor ?? '(none)'}`);
      }
      return;
    }

    if (command === 'source' && subcommand === 'enable') {
      const sourceId = args[2];
      if (!sourceId) throw new Error('Usage: mindstrate-scan source enable <source-id>');
      service.enableSource(sourceId);
      console.log(`Enabled source ${sourceId}`);
      return;
    }

    if (command === 'source' && subcommand === 'disable') {
      const sourceId = args[2];
      if (!sourceId) throw new Error('Usage: mindstrate-scan source disable <source-id>');
      service.disableSource(sourceId);
      console.log(`Disabled source ${sourceId}`);
      return;
    }

    if (command === 'run') {
      const sourceId = args[1];
      if (!sourceId) throw new Error('Usage: mindstrate-scan run <source-id>');
      const result = await service.runSource(sourceId);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'runs') {
      const sourceId = args[1];
      if (!sourceId) throw new Error('Usage: mindstrate-scan runs <source-id>');
      console.log(JSON.stringify(service.listRuns(sourceId), null, 2));
      return;
    }

    if (command === 'status') {
      const sourceId = args[1];
      if (!sourceId) throw new Error('Usage: mindstrate-scan status <source-id>');
      console.log(JSON.stringify(service.getSourceStatus(sourceId), null, 2));
      return;
    }

    if (command === 'failed') {
      const sourceId = args[1];
      if (!sourceId) throw new Error('Usage: mindstrate-scan failed <source-id>');
      console.log(JSON.stringify(service.listFailedItems(sourceId), null, 2));
      return;
    }

    if (command === 'retry-failed') {
      const sourceId = args[1];
      if (!sourceId) throw new Error('Usage: mindstrate-scan retry-failed <source-id>');
      const result = await service.retryFailedItems(sourceId);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'daemon') {
      const daemon = new RepoScannerDaemon(service, {
        tickMs: Number(value('--tick-ms', args, '30000')),
      });
      daemon.start();
      console.log('repo-scanner daemon started');
      const shutdown = async () => {
        await daemon.stop();
        await service.close();
        process.exit(0);
      };
      process.on('SIGINT', () => { void shutdown(); });
      process.on('SIGTERM', () => { void shutdown(); });
      return;
    }

    console.log([
      'Usage:',
      '  mindstrate-scan source add-git --name <name> --project <project> --repo-path <path> [--branch main]',
      '  mindstrate-scan source list',
      '  mindstrate-scan source enable <source-id>',
      '  mindstrate-scan source disable <source-id>',
      '  mindstrate-scan run <source-id>',
      '  mindstrate-scan status <source-id>',
      '  mindstrate-scan runs <source-id>',
      '  mindstrate-scan failed <source-id>',
      '  mindstrate-scan retry-failed <source-id>',
      '  mindstrate-scan daemon [--tick-ms 30000]',
    ].join('\n'));
  } finally {
    if (commandExits(process.argv.slice(2))) {
      await service.close();
    }
  }
}

function commandExits(args: string[]): boolean {
  return args[0] !== 'daemon';
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
