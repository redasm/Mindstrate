/**
 * Mindstrate - Retrieval Evaluation Models
 *
 * Shared shapes for the validation/holdout eval dataset and run results.
 * Kept in protocol so clients can author datasets over HTTP without the
 * server runtime.
 */

export type EvalCaseKind = 'validation' | 'holdout';

export interface EvalCase {
  id: string;
  query: string;
  expectedIds: string[];
  kind: EvalCaseKind;
  language?: string;
  framework?: string;
  createdAt: string;
}

export interface EvalCaseResult {
  caseId: string;
  query: string;
  expectedIds: string[];
  retrievedIds: string[];
  hits: string[];
  misses: string[];
  precision: number;
  recall: number;
}

export interface EvalRunResult {
  runId: string;
  timestamp: string;
  totalCases: number;
  precision: number;
  recall: number;
  f1: number;
  meanReciprocalRank: number;
  details: EvalCaseResult[];
}
