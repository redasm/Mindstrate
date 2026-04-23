import { NextRequest, NextResponse } from 'next/server';
import { getMemory } from '@/lib/memory';

/** GET /api/context-graph - query ECS graph nodes */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;
    const query = params.get('query') || undefined;
    const project = params.get('project') || undefined;
    const substrateType = params.get('substrateType') || undefined;
    const domainType = params.get('domainType') || undefined;
    const status = params.get('status') || undefined;
    const limit = parseInt(params.get('limit') || '50', 10);

    const nodes = memory.queryContextGraph({
      query,
      project,
      substrateType: substrateType as never,
      domainType: domainType as never,
      status: status as never,
      limit,
    });
    return NextResponse.json({ nodes, total: nodes.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
