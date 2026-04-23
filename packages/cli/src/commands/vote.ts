/**
 * mindstrate vote - 对知识投票
 */

import { Command } from 'commander';
import { createMemory, findKnowledge } from '../helpers.js';

export const voteCommand = new Command('vote')
  .description('Upvote or downvote a knowledge entry')
  .argument('<id>', 'Knowledge entry ID (full or partial)')
  .argument('<direction>', 'Vote direction: up or down')
  .action(async (id, direction) => {
    if (direction !== 'up' && direction !== 'down') {
      console.error('Error: direction must be "up" or "down"');
      process.exit(1);
    }

    const memory = createMemory();

    try {
      const knowledge = findKnowledge(memory, id);

      if (!knowledge) {
        console.error(`Knowledge not found: ${id}`);
        console.error('Use "mindstrate list" to see available entries.');
        process.exit(1);
      }

      if (direction === 'up') {
        memory.upvote(knowledge.id);
      } else {
        memory.downvote(knowledge.id);
      }

      const updated = memory.get(knowledge.id)!;
      console.log(`Vote recorded: ${direction === 'up' ? '+1' : '-1'}`);
      console.log(`  ${updated.title}`);
      console.log(`  Votes: +${updated.quality.upvotes}/-${updated.quality.downvotes}`);
    } catch (error) {
      console.error('Vote failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
