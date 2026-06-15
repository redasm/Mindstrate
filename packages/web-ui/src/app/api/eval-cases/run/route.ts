import { NextRequest, NextResponse } from 'next/server';
import type { EvalCaseKind } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/** POST /api/eval-cases/run - run retrieval evaluation over the dataset */
export async function POST(request: NextRequest) {
  try {
    const memory = await getMemoryReady();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const topK = typeof body.topK === 'number' ? body.topK : undefined;
    const kind = typeof body.kind === 'string' ? (body.kind as EvalCaseKind) : undefined;
    const result = await memory.evaluation.runEvaluation(topK, kind ? { kind } : undefined);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
