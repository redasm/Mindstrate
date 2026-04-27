/**
 * mindstrate export / mindstrate import - 知识导入导出
 *
 * 用于团队共享知识库：导出为 JSON 文件，其他人 import 即可合并。
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import { createMemory, errorMessage } from '../helpers.js';

export const exportCommand = new Command('export')
  .description('Export ECS graph knowledge views to a JSON file')
  .argument('[file]', 'Output file path', 'mindstrate-export.json')
  .option('--pretty', 'Pretty-print JSON', false)
  .action(async (file, options) => {
    const memory = createMemory();

    try {
      await memory.init();
      const entries = memory.readGraphKnowledge({ limit: 10000 });

      if (entries.length === 0) {
        console.log('Nothing to export. ECS graph knowledge is empty.');
        return;
      }

      const exportData = {
        format: 'mindstrate.graph-knowledge',
        version: '0.2.0',
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
      console.error('Export failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });

export const importCommand = new Command('import')
  .description('Import ECS graph knowledge from a JSON file')
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

      if (data.format !== 'mindstrate.graph-knowledge' || !Array.isArray(data.entries)) {
        console.error('Invalid ECS graph knowledge export file format.');
        process.exit(1);
      }

      let imported = 0;
      let failed = 0;

      for (const entry of data.entries) {
        try {
          const existing = memory.readGraphKnowledge({ limit: 100000 })
            .find((view) => view.id === entry.id);
          if (existing) continue;

          memory.createContextNode({
            substrateType: entry.substrateType,
            domainType: entry.domainType,
            title: entry.title,
            content: entry.summary,
            tags: entry.tags ?? [],
            project: entry.project,
            status: entry.status,
            sourceRef: entry.sourceRef,
            confidence: Math.min(1, entry.priorityScore ?? 0.5),
            qualityScore: Math.min(100, Math.round((entry.priorityScore ?? 0.5) * 100)),
            metadata: {
              importedFrom: 'mindstrate.graph-knowledge',
              originalId: entry.id,
            },
          });
          imported++;
        } catch {
          failed++;
        }
      }

      console.log(`Import complete:`);
      console.log(`  Imported: ${imported}`);
      if (failed > 0) console.log(`  Failed:   ${failed}`);
    } catch (error) {
      console.error('Import failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });
