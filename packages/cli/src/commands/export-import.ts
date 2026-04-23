/**
 * mindstrate export / mindstrate import - 知识导入导出
 *
 * 用于团队共享知识库：导出为 JSON 文件，其他人 import 即可合并。
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import { createMemory } from '../helpers.js';

export const exportCommand = new Command('export')
  .description('Export knowledge base to a JSON file')
  .argument('[file]', 'Output file path', 'mindstrate-export.json')
  .option('--pretty', 'Pretty-print JSON', false)
  .action(async (file, options) => {
    const memory = createMemory();

    try {
      const entries = memory.list({}, 10000);

      if (entries.length === 0) {
        console.log('Nothing to export. Knowledge base is empty.');
        return;
      }

      const exportData = {
        version: '0.1.0',
        exportedAt: new Date().toISOString(),
        count: entries.length,
        entries,
      };

      const json = options.pretty
        ? JSON.stringify(exportData, null, 2)
        : JSON.stringify(exportData);

      fs.writeFileSync(file, json, 'utf-8');
      console.log(`Exported ${entries.length} entries to ${file}`);
    } catch (error) {
      console.error('Export failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });

export const importCommand = new Command('import')
  .description('Import knowledge from a JSON file')
  .argument('<file>', 'Input file path')
  .option('--skip-duplicates', 'Skip entries that already exist', true)
  .action(async (file, _options) => {
    if (!fs.existsSync(file)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }

    const memory = createMemory();

    try {
      await memory.init();

      const raw = fs.readFileSync(file, 'utf-8');
      const data = JSON.parse(raw);

      if (!data.entries || !Array.isArray(data.entries)) {
        console.error('Invalid export file format.');
        process.exit(1);
      }

      let imported = 0;
      let skipped = 0;
      let failed = 0;

      for (const entry of data.entries) {
        try {
          const result = await memory.add({
            type: entry.type,
            title: entry.title,
            problem: entry.problem,
            solution: entry.solution,
            codeSnippets: entry.codeSnippets,
            tags: entry.tags,
            context: entry.context,
            author: entry.metadata?.author,
            source: entry.metadata?.source,
            commitHash: entry.metadata?.commitHash,
            confidence: entry.metadata?.confidence,
          });

          if (result.success) {
            imported++;
          } else if (result.duplicateOf) {
            skipped++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      console.log(`Import complete:`);
      console.log(`  Imported: ${imported}`);
      console.log(`  Skipped (duplicates): ${skipped}`);
      if (failed > 0) console.log(`  Failed:   ${failed}`);
    } catch (error) {
      console.error('Import failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
