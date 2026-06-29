import { NextRequest, NextResponse } from 'next/server';
import { getMemory } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/** GET /api/graph-knowledge - ECS-native graph knowledge views */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;
    const project = params.get('project') || undefined;
    // No `limit` param → full set (projector excludes the scanner graph).
    const limitParam = params.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const entries = memory.context.readGraphKnowledge({ project, limit });
    return NextResponse.json({ entries, total: entries.length });
  } catch (error) {
    return errorResponse(error);
  }
}
