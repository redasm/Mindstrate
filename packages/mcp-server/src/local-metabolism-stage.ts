import type { LocalMemory } from './types.js';

export function runLocalMetabolismStage(
  memory: LocalMemory,
  stage: 'digest' | 'assimilate' | 'compress' | 'prune' | 'reflect',
  options?: { project?: string },
): unknown {
  switch (stage) {
    case 'digest':
      return memory.metabolism.runDigest(options);
    case 'assimilate':
      return memory.metabolism.runAssimilation(options);
    case 'compress':
      return memory.metabolism.runCompression(options);
    case 'prune':
      return memory.metabolism.runPruning(options);
    case 'reflect':
      return memory.metabolism.runReflection(options);
  }
}
