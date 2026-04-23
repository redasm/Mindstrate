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

/** POST /api/metabolism-runs - trigger an ECS metabolism run */
export async function POST(request: NextRequest) {
  try {
    const memory = getMemory();
    const body = await request.json().catch(() => ({}));
    const run = await memory.runMetabolism({
      project: body.project || undefined,
      trigger: body.trigger || 'manual',
    });
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
