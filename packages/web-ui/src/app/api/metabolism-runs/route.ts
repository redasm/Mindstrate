import { NextRequest, NextResponse } from 'next/server';
import { getMemory } from '@/lib/memory';

/** GET /api/metabolism-runs - list recent ECS metabolism runs */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;
    const project = params.get('project') || undefined;
    const limit = parseInt(params.get('limit') || '10', 10);

    const runs = memory.listMetabolismRuns(project, limit);
    return NextResponse.json({ runs, total: runs.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
