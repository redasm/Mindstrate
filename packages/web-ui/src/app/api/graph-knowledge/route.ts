import { NextRequest, NextResponse } from 'next/server';
import { getMemory } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/** GET /api/graph-knowledge - ECS-native graph knowledge views */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;
    const project = params.get('project') || undefined;
    const limit = parseInt(params.get('limit') || '50', 10);

    const entries = memory.context.readGraphKnowledge({ project, limit });
    return NextResponse.json({ entries, total: entries.length });
  } catch (error) {
    return errorResponse(error);
  }
}
