import { NextRequest, NextResponse } from 'next/server';
import type { EvalCaseKind } from '@mindstrate/protocol';
import { getMemory, getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { requireAdminFromRequest } from '@/lib/session';

const guard = (req: NextRequest): Response | null => {
  try {
    requireAdminFromRequest(req);
    return null;
  } catch (resp) {
    return resp as Response;
  }
};

/** GET /api/eval-cases - list eval dataset cases (optionally by kind) */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const kind = (request.nextUrl.searchParams.get('kind') as EvalCaseKind | null) || undefined;
    const cases = memory.evaluation.listEvalCases(kind ? { kind } : undefined);
    return NextResponse.json({ cases, total: cases.length });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/eval-cases - add an eval case (admin) */
export async function POST(request: NextRequest) {
  const denied = guard(request); if (denied) return denied;
  try {
    const memory = await getMemoryReady();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const query = typeof body.query === 'string' ? body.query : '';
    const expectedIds = Array.isArray(body.expectedIds) ? body.expectedIds.filter((id): id is string => typeof id === 'string') : [];
    if (!query || expectedIds.length === 0) {
      return NextResponse.json({ error: 'query and expectedIds are required' }, { status: 400 });
    }
    const created = memory.evaluation.addEvalCase(query, expectedIds, {
      language: typeof body.language === 'string' ? body.language : undefined,
      framework: typeof body.framework === 'string' ? body.framework : undefined,
      kind: body.kind as EvalCaseKind | undefined,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
