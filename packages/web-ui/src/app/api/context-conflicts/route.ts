import { NextRequest, NextResponse } from 'next/server';
import { getMemory } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/** GET /api/context-conflicts - list ECS conflict records */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;
    const project = params.get('project') || undefined;
    const limit = parseInt(params.get('limit') || '20', 10);

    const conflicts = memory.context.listConflictRecords(project, limit);
    return NextResponse.json({ conflicts, total: conflicts.length });
  } catch (error) {
    return errorResponse(error);
  }
}
