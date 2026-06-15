#!/usr/bin/env node
import { RepoScannerService } from './scanner-service.js';
import { RepoScannerDaemon } from './scheduler.js';
import { CaptureSource, Mindstrate, consoleLogger, errorMessage } from '@mindstrate/server';
import { getCommitInfo, getGitRoot, getLastCommit, getRecentCommits } from './git-source.js';
import { installGitHook, uninstallGitHook } from './hook-installer.js';
import { getChangelistInfo, getRecentChangelists, isP4Available } from './p4-source.js';
import * as path from 'node:path';

function value(flag: string, args: string[], fallback?: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  return args[index + 1];
}

function optionalNumber(flag: string, args: string[]): number | undefined {
  const raw = value(flag, args);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number for ${flag}: ${raw}`);
  return parsed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const memory = new Mindstrate({ logger: consoleLogger });
  await memory.init();
  const service = new RepoScannerService({ memory });
  await service.init();

  try {
    const [command, subcommand] = args;

    if (command === 'source' && subcommand === 'add-git') {
      const name = value('--name', args);
      const project = value('--project', args);
      const repoPath = value('--repo-path', args);
      const remoteUrl = value('--remote-url', args);
      if (!name || !project || (!repoPath && !remoteUrl)) {
        throw new Error('Usage: mindstrate-scan source add-git --name <name> --project <project> (--repo-path <path> | --remote-url <url>) [--git-token <token>] [--branch main]');
      }
      const source = service.addGitLocalSource({
        name,
        project,
        repoPath: repoPath ?? `/repos/${name}`,
        branch: value('--branch', args),
        remoteUrl,
        authToken: value('--git-token', args),
        intervalSec: Number(value('--interval-sec', args, '300')),
        initMode: (value('--init-mode', args, 'from_now') as 'from_now' | 'backfill_recent'),
        backfillCount: Number(value('--backfill-count', args, '10')),
      });
      console.log(`Added source ${source.id} (${source.name})`);
      return;
    }

    if (command === 'source' && subcommand === 'add-p4') {
      const name = value('--name', args);
      const project = value('--project', args);
      if (!name || !project) {
        throw new Error('Usage: mindstrate-scan source add-p4 --name <name> --project <project> [--repo-path <workspace-root>] [--depot //depot/main/...] [--p4-port <host>] [--p4-user <user>] [--p4-password <pwd>]');
      }
      if (!isP4Available()) {
        throw new Error('p4 command not found — install Perforce CLI (or rebuild scanner image with INSTALL_P4=1) before registering a P4 source');
      }
      const source = service.addP4Source({
        name,
        project,
        repoPath: value('--repo-path', args),
        depotPath: value('--depot', args),
        p4Port: value('--p4-port', args),
        p4User: value('--p4-user', args),
        p4Passwd: value('--p4-password', args),
        intervalSec: Number(value('--interval-sec', args, '300')),
        initMode: (value('--init-mode', args, 'from_now') as 'from_now' | 'backfill_recent'),
        backfillCount: Number(value('--backfill-count', args, '10')),
      });
      console.log(`Added source ${source.id} (${source.name})`);
      return;
    }

    if (command === 'source' && subcommand === 'update') {
      const sourceId = args[2];
      if (!sourceId) throw new Error('Usage: mindstrate-scan source update <source-id> [flags]');
      const updated = service.scanner.updateSource(sourceId, {
        name: value('--name', args),
        project: value('--project', args),
        repoPath: value('--repo-path', args),
        depotPath: value('--depot', args),
        branch: value('--branch', args),
        remoteUrl: value('--remote-url', args),
        authToken: value('--git-token', args),
        p4Port: value('--p4-port', args),
        p4User: value('--p4-user', args),
        p4Passwd: value('--p4-password', args),
        intervalSec: optionalNumber('--interval-sec', args),
        initMode: value('--init-mode', args) as 'from_now' | 'backfill_recent' | undefined,
        backfillCount: optionalNumber('--backfill-count', args),
      });
      if (!updated) throw new Error(`Unknown source: ${sourceId}`);
      console.log(`Updated source ${updated.id}`);
      return;
    }

    if (command === 'source' && subcommand === 'delete') {
      const sourceId = args[2];
      if (!sourceId) throw new Error('Usage: mindstrate-scan source delete <source-id>');
      if (!service.deleteSource(sourceId)) {
        throw new Error(`Unknown source: ${sourceId}`);
      }
      console.log(`Deleted source ${sourceId}`);
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

    if (command === 'ingest' && subcommand === 'git') {
      const repoPath = value('--repo-path', args, process.cwd())!;
      const project = value('--project', args, path.basename(repoPath))!;
      const dryRun = args.includes('--dry-run');
      const auto = args.includes('--auto');
      const recent = Number(value('--recent', args, '0'));

      const commits = collectGitCommits({
        repoPath,
        commit: value('--commit', args),
        lastCommit: args.includes('--last-commit'),
        recent,
      });

      await ingestCommits(service, commits, {
        project,
        dryRun,
        auto,
        captureSource: CaptureSource.GIT_HOOK,
        recordGitActivity: !auto && !dryRun,
      });
      return;
    }

    if (command === 'ingest' && subcommand === 'p4') {
      if (!isP4Available()) {
        throw new Error('p4 command not found');
      }

      const project = value('--project', args, path.basename(process.cwd()))!;
      const dryRun = args.includes('--dry-run');
      const changelist = value('--changelist', args);
      const depot = value('--depot', args);
      const recent = Number(value('--recent', args, '10'));
      const commits = changelist
        ? [getChangelistInfo(changelist)].filter(Boolean)
        : getRecentChangelists(recent, depot).map((id) => getChangelistInfo(id)).filter(Boolean);

      await ingestCommits(service, commits, {
        project,
        dryRun,
        auto: false,
        captureSource: CaptureSource.P4_TRIGGER,
        recordGitActivity: false,
      });
      return;
    }

    if (command === 'hook' && subcommand === 'install') {
      const repoPath = value('--repo-path', args, process.cwd())!;
      const gitRoot = getGitRoot(repoPath);
      if (!gitRoot) {
        throw new Error('Not a git repository');
      }
      const cliPath = path.resolve(__dirname, 'cli.js');
      if (!installGitHook(repoPath, cliPath)) {
        throw new Error('Failed to install git hook');
      }
      console.log(`Git hook installed in ${gitRoot}`);
      return;
    }

    if (command === 'hook' && subcommand === 'uninstall') {
      const repoPath = value('--repo-path', args, process.cwd())!;
      if (!uninstallGitHook(repoPath)) {
        throw new Error('Failed to uninstall git hook');
      }
      console.log('Git hook removed');
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
        memory.close();
        process.exit(0);
      };
      process.on('SIGINT', () => { void shutdown(); });
      process.on('SIGTERM', () => { void shutdown(); });
      return;
    }

    console.log([
      'Usage:',
      '  mindstrate-scan ingest git [--repo-path <path>] [--project <project>] [--last-commit | --commit <hash> | --recent <n>] [--dry-run] [--auto]',
      '  mindstrate-scan ingest p4 [--project <project>] [--changelist <cl> | --recent <n>] [--depot <path>] [--dry-run]',
      '  mindstrate-scan hook install [--repo-path <path>]',
      '  mindstrate-scan hook uninstall [--repo-path <path>]',
      '  mindstrate-scan source add-git --name <name> --project <project> (--repo-path <path> | --remote-url <url>) [--git-token <token>] [--branch main]',
      '  mindstrate-scan source add-p4 --name <name> --project <project> [--depot //depot/main/...] [--p4-port <host>] [--p4-user <user>] [--p4-password <pwd>]',
      '  mindstrate-scan source update <source-id> [--name ...] [--project ...] [--remote-url ...] [--git-token ...] [--p4-port ...] [--p4-user ...] [--p4-password ...] [--interval-sec ...] [--init-mode from_now|backfill_recent] [--backfill-count ...]',
      '  mindstrate-scan source delete <source-id>',
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
      memory.close();
    }
  }
}

function commandExits(args: string[]): boolean {
  return args[0] !== 'daemon';
}

function collectGitCommits(options: {
  repoPath: string;
  commit?: string;
  lastCommit: boolean;
  recent: number;
}) {
  if (options.lastCommit) {
    const commit = getLastCommit(options.repoPath);
    if (!commit) throw new Error('Failed to read last commit');
    return [commit];
  }

  if (options.commit) {
    const commit = getCommitInfo(options.commit, options.repoPath);
    if (!commit) throw new Error(`Failed to read commit: ${options.commit}`);
    return [commit];
  }

  const count = options.recent > 0 ? options.recent : 5;
  return getRecentCommits(count, options.repoPath)
    .map((hash) => getCommitInfo(hash, options.repoPath))
    .filter(Boolean);
}

async function ingestCommits(
  service: RepoScannerService,
  commits: Array<Awaited<ReturnType<typeof getLastCommit>>>,
  options: {
    project: string;
    dryRun: boolean;
    auto: boolean;
    captureSource: CaptureSource;
    recordGitActivity: boolean;
  },
): Promise<void> {
  let imported = 0;
  let skipped = 0;

  for (const commit of commits) {
    if (!commit) continue;
    const result = await service.ingestCommit({
      project: options.project,
      commit,
      captureSource: options.captureSource,
      recordGitActivity: options.recordGitActivity,
      dryRun: options.dryRun,
    });

    if (result.status === 'imported') {
      imported++;
      if (!options.auto) {
        if (options.dryRun && result.preview) {
          console.log(`WOULD IMPORT  [${result.preview.type}] ${result.preview.title}`);
        } else if (result.view) {
          console.log(`IMPORTED      [${result.view.domainType}] ${result.view.title}`);
        }
      }
    } else {
      skipped++;
      if (!options.auto) {
        console.log(`SKIP          ${commit.hash.substring(0, 12)}  ${result.reason}`);
      }
    }
  }

  if (!options.auto) {
    console.log(`\nDone: ${imported} imported, ${skipped} skipped.`);
  }
}

void main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});
