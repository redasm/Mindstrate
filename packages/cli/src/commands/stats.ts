/**
 * mindstrate stats - 查看统计信息
 */

import { Command } from 'commander';
import { createMemory, errorMessage, TYPE_LABELS, STATUS_LABELS } from '../helpers.js';

export const statsCommand = new Command('stats')
  .description('Show knowledge base statistics')
  .action(async () => {
    const memory = createMemory();

    try {
      const stats = await memory.getStats();

      console.log('Mindstrate Statistics\n');
      console.log(`  Total knowledge entries: ${stats.total}`);
      console.log(`  Vector embeddings:       ${stats.vectorCount}`);

      if (Object.keys(stats.byType).length > 0) {
        console.log('\n  By Type:');
        for (const [type, count] of Object.entries(stats.byType)) {
          const label = TYPE_LABELS[type] ?? type;
          console.log(`    ${label.padEnd(12)} ${count}`);
        }
      }

      if (Object.keys(stats.byStatus).length > 0) {
        console.log('\n  By Status:');
        for (const [status, count] of Object.entries(stats.byStatus)) {
          const label = STATUS_LABELS[status] ?? status;
          console.log(`    ${label.padEnd(12)} ${count}`);
        }
      }

      if (Object.keys(stats.byLanguage).length > 0) {
        console.log('\n  By Language:');
        for (const [lang, count] of Object.entries(stats.byLanguage)) {
          console.log(`    ${lang.padEnd(12)} ${count}`);
        }
      }

      console.log(`\n  Config: ${memory.getConfig().dataDir}`);
    } catch (error) {
      console.error('Failed to get stats:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });
