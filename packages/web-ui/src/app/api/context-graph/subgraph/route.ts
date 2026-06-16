import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/**
 * GET /api/context-graph/subgraph — bounded project-graph subgraph for the
 * relationship-graph view.
 *   ?project=  (required)
 *   ?focus=    (optional node id) one-hop neighborhood around this node
 *   ?kinds=    (optional, comma-separated node kinds; skeleton default: directory,file)
 *   ?limit=    (optional, default 300)
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const project = params.get('project') || undefined;
    if (!project) {
      return NextResponse.json({ error: 'project is required' }, { status: 400 });
    }
    const focusNodeId = params.get('focus') || undefined;
    const kindsParam = params.get('kinds');
    const nodeKinds = kindsParam
      ? kindsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const limit = parseInt(params.get('limit') || '300', 10);

    const memory = await getMemoryReady();
    const { nodes, edges } = memory.context.queryProjectSubgraph({ project, focusNodeId, nodeKinds, limit });
    return NextResponse.json({ nodes, edges });
  } catch (error) {
    return errorResponse(error);
  }
}
