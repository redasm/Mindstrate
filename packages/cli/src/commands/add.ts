/**
 * mindstrate add - 添加一条知识
 *
 * 支持两种模式：
 * 1. 交互式（无参数）
 * 2. 命令行参数
 */

import { Command } from 'commander';
import { KnowledgeType, CaptureSource } from '@mindstrate/server';
import { createMemory, errorMessage, TYPE_LABELS } from '../helpers.js';

export const addCommand = new Command('add')
  .description('Add a new knowledge entry')
  .option('-t, --type <type>', `Knowledge type (${Object.values(KnowledgeType).join(', ')})`, 'how_to')
  .option('--title <title>', 'Short title')
  .option('-p, --problem <problem>', 'Problem description')
  .option('-s, --solution <solution>', 'Solution content')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--language <lang>', 'Programming language')
  .option('--framework <framework>', 'Framework')
  .option('--project <project>', 'Project name')
  .option('--author <author>', 'Author name')
  .action(async (options) => {
    // 检查必填字段
    if (!options.title || !options.solution) {
      console.log('Usage: mindstrate add --title "Title" --solution "Solution content"\n');
      console.log('Required:');
      console.log('  --title <title>       Short descriptive title');
      console.log('  --solution <solution>  The solution or knowledge content');
      console.log('\nOptional:');
      console.log('  --type <type>          Knowledge type (default: how_to)');
      console.log(`                         Options: ${Object.values(KnowledgeType).join(', ')}`);
      console.log('  --problem <problem>    Problem description');
      console.log('  --tags <tags>          Comma-separated tags');
      console.log('  --language <lang>      Programming language');
      console.log('  --framework <fw>       Framework name');
      console.log('  --project <name>       Project name');
      console.log('  --author <name>        Author name');
      console.log('\nExample:');
      console.log('  mindstrate add --title "Fix React useEffect memory leak" \\');
      console.log('         --type bug_fix \\');
      console.log('         --problem "setState called after component unmount" \\');
      console.log('         --solution "Use AbortController for async cleanup" \\');
      console.log('         --tags "react,hooks,memory-leak" \\');
      console.log('         --language typescript');
      return;
    }

    const memory = createMemory();

    try {
      await memory.init();

      const tags = options.tags
        ? options.tags.split(',').map((t: string) => t.trim())
        : [];

      const result = await memory.add({
        type: options.type as KnowledgeType,
        title: options.title,
        problem: options.problem,
        solution: options.solution,
        tags,
        context: {
          language: options.language,
          framework: options.framework,
          project: options.project,
        },
        author: options.author,
        source: CaptureSource.CLI,
      });

      if (result.success && result.view) {
        console.log('ECS context node added successfully!\n');
        console.log(`  ID:        ${result.view.id}`);
        console.log(`  Title:     ${result.view.title}`);
        console.log(`  Substrate: ${result.view.substrateType}`);
        if (tags.length > 0) {
          console.log(`  Tags:  ${tags.join(', ')}`);
        }
      } else {
        console.log(`Note: ${result.message}`);
        if (result.duplicateOf) {
          console.log(`\nDuplicate of knowledge ID: ${result.duplicateOf}`);
        }
      }
    } catch (error) {
      console.error('Failed to add knowledge:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });
