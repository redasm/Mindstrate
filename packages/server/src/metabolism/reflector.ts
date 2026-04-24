import {
  MetabolismStage,
  type MetabolismStageStats,
} from '@mindstrate/protocol/models';
import { ConflictDetector } from '../context-graph/conflict-detector.js';
import { ConflictReflector } from '../context-graph/conflict-reflector.js';
import type { MetabolismStageOptions } from './metabolism-engine.js';

export interface ReflectionStageResult extends MetabolismStageStats {
  stage: MetabolismStage.REFLECT;
  conflictsDetected: number;
  candidateNodesCreated: number;
}

export class Reflector {
  constructor(private readonly deps: {
    conflictDetector: ConflictDetector;
    conflictReflector: ConflictReflector;
  }) {}

  async run(options: MetabolismStageOptions = {}): Promise<ReflectionStageResult> {
    const conflicts = await this.deps.conflictDetector.detectConflicts({
      project: options.project,
    });
    const reflection = this.deps.conflictReflector.reflectConflicts({
      project: options.project,
    });

    return {
      stage: MetabolismStage.REFLECT,
      scanned: conflicts.scannedNodes,
      created: reflection.candidateNodesCreated,
      updated: conflicts.conflictsDetected,
      skipped: 0,
      conflictsDetected: conflicts.conflictsDetected,
      candidateNodesCreated: reflection.candidateNodesCreated,
    };
  }
}
