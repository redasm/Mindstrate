import { NextRequest, NextResponse } from 'next/server';
import { getMemory } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/** GET /api/context-edges - list ECS graph edges */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;
    const sourceId = params.get('sourceId') || undefined;
    const targetId = params.get('targetId') || undefined;
    const relationType = params.get('relationType') || undefined;
    const limit = parseInt(params.get('limit') || '200', 10);

    const edges = memory.context.listContextEdges({
      sourceId,
      targetId,
      relationType: relationType as never,
      limit,
    });
    return NextResponse.json({ edges, total: edges.length });
  } catch (error) {
    return errorResponse(error);
  }
}
