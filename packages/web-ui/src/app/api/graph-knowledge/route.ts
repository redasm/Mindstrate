import { NextRequest, NextResponse } from 'next/server';
import { getMemory } from '@/lib/memory';

/** GET /api/graph-knowledge - ECS-native graph knowledge views */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;
    const project = params.get('project') || undefined;
    const limit = parseInt(params.get('limit') || '50', 10);

    const entries = memory.readGraphKnowledge({ project, limit });
    return NextResponse.json({ entries, total: entries.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
