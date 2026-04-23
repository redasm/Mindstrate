/**
 * mindstrate capture - 从 git commit 或 P4 changelist 中采集知识
 *
 * Git 模式：
 *   mindstrate capture --last-commit
 *   mindstrate capture --commit <hash>
 *   mindstrate capture --recent 10
 *
 * P4 模式：
 *   mindstrate capture --p4 --changelist <CL>
 *   mindstrate capture --p4 --recent 10
 *   mindstrate capture --p4 --recent 10 --depot //depot/project/...
 */

import { Command } from 'commander';
import {
  KnowledgeExtractor,
  CaptureSource,
  getLastCommit,
  getCommitInfo,
  getRecentCommits,
  isP4Available,
  isP4Connected,
  getChangelistInfo,
  getRecentChangelists,
} from '@mindstrate/server';
import type { CommitInfo } from '@mindstrate/server';
import { createMemory, TYPE_LABELS } from '../helpers.js';

export const captureCommand = new Command('capture')
  .description('Capture knowledge from git commits or P4 changelists')
  .option('--last-commit', 'Capture from the last git commit')
  .option('--commit <hash>', 'Capture from a specific git commit')
  .option('--p4', 'Use Perforce (P4) instead of Git')
  .option('--changelist <cl>', 'Capture from a specific P4 changelist')
  .option('--depot <path>', 'P4 depot path filter (e.g., //depot/project/...)')
  .option('--recent <n>', 'Scan last N commits/changelists', '5')
  .option('--auto', 'Auto mode (no confirmation, used by hooks)', false)
  .option('--dry-run', 'Show what would be captured without saving', false)
  .action(async (options) => {
    const memory = createMemory();
    const config = memory.getConfig();
    const extractor = new KnowledgeExtractor(config.openaiApiKey);

    try {
      await memory.init();

      const commits: CommitInfo[] = options.p4
        ? await collectP4Changelists(options)
        : collectGitCommits(options);

      let captured = 0;
      let skipped = 0;

      for (const commit of commits) {
        if (!options.dryRun && !options.p4) {
          memory.ingestGitActivity({
            content: `${commit.message.split('\n')[0]}\nFiles: ${commit.files.join(', ')}`,
            project: process.cwd().split(/[/\\]/).pop(),
            actor: commit.author,
            sourceRef: commit.hash,
            metadata: {
              commitHash: commit.hash,
              files: commit.files,
            },
          });
        }

        const result = await extractor.extractFromCommit(commit);

        if (!result.extracted || !result.knowledge) {
          skipped++;
          if (!options.auto) {
            const label = commit.hash.substring(0, 12);
            console.log(`  SKIP  ${label} ${commit.message.split('\n')[0]}`);
            console.log(`        Reason: ${result.reason}`);
          }
          continue;
        }

        // P4 来源标记
        if (options.p4) {
          result.knowledge.source = CaptureSource.P4_TRIGGER;
        }

        if (options.dryRun) {
          const k = result.knowledge;
          const typeLabel = TYPE_LABELS[k.type] ?? k.type;
          console.log(`  WOULD CAPTURE  ${commit.hash.substring(0, 12)}`);
          console.log(`    Type:     ${typeLabel}`);
          console.log(`    Title:    ${k.title}`);
          if (k.problem) console.log(`    Problem:  ${k.problem}`);
          console.log(`    Solution: ${k.solution.substring(0, 100)}...`);
          console.log(`    Tags:     ${(k.tags ?? []).join(', ')}`);
          console.log(`    Confidence: ${(k.confidence ?? 0.5) * 100}%`);
          console.log('');
          captured++;
          continue;
        }

        const addResult = await memory.add(result.knowledge);

        if (addResult.success) {
          captured++;
          if (!options.auto) {
            const typeLabel = TYPE_LABELS[result.knowledge.type] ?? result.knowledge.type;
            console.log(`  CAPTURED  ${commit.hash.substring(0, 12)} → [${typeLabel}] ${result.knowledge.title}`);
          }
        } else {
          skipped++;
          if (!options.auto) {
            console.log(`  SKIP  ${commit.hash.substring(0, 12)} ${addResult.message}`);
          }
        }
      }

      if (!options.auto) {
        const source = options.p4 ? 'P4 changelists' : 'git commits';
        console.log(`\nDone: ${captured} captured, ${skipped} skipped (from ${source}).`);
      }
    } catch (error) {
      if (!options.auto) {
        console.error('Capture failed:', error instanceof Error ? error.message : error);
      }
      process.exit(1);
    } finally {
      memory.close();
    }
  });

// ============================================================
// Git collection
// ============================================================

function collectGitCommits(options: any): CommitInfo[] {
  const commits: CommitInfo[] = [];

  if (options.lastCommit) {
    const commit = getLastCommit();
    if (!commit) {
      if (!options.auto) console.error('Failed to get last commit. Is this a git repository?');
      process.exit(1);
    }
    commits.push(commit);
  } else if (options.commit) {
    const commit = getCommitInfo(options.commit);
    if (!commit) {
      console.error(`Failed to get commit: ${options.commit}`);
      process.exit(1);
    }
    commits.push(commit);
  } else {
    const n = parseInt(options.recent, 10);
    const hashes = getRecentCommits(n);

    if (hashes.length === 0) {
      if (!options.auto) console.log('No git commits found.');
      return [];
    }

    if (!options.auto) {
      console.log(`Scanning last ${hashes.length} git commits...\n`);
    }

    for (const h of hashes) {
      const commit = getCommitInfo(h);
      if (commit) commits.push(commit);
    }
  }

  return commits;
}

// ============================================================
// P4 collection
// ============================================================

async function collectP4Changelists(options: any): Promise<CommitInfo[]> {
  if (!isP4Available()) {
    console.error('Error: p4 command not found. Install Perforce CLI (p4) and ensure it is in PATH.');
    process.exit(1);
  }

  if (!isP4Connected()) {
    console.error('Error: Cannot connect to Perforce server. Check P4PORT, P4USER, P4CLIENT settings.');
    process.exit(1);
  }

  const commits: CommitInfo[] = [];

  if (options.changelist) {
    const info = getChangelistInfo(options.changelist);
    if (!info) {
      console.error(`Failed to get P4 changelist: ${options.changelist}`);
      process.exit(1);
    }
    commits.push(info);
  } else {
    const n = parseInt(options.recent, 10);
    const cls = getRecentChangelists(n, options.depot);

    if (cls.length === 0) {
      if (!options.auto) console.log('No P4 changelists found.');
      return [];
    }

    if (!options.auto) {
      console.log(`Scanning last ${cls.length} P4 changelists${options.depot ? ` in ${options.depot}` : ''}...\n`);
    }

    for (const cl of cls) {
      const info = getChangelistInfo(cl);
      if (info) commits.push(info);
    }
  }

  return commits;
}
