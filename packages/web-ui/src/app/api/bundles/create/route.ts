import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/** POST /api/bundles/create - create a portable ECS context bundle */
export async function POST(request: NextRequest) {
  try {
    const memory = await getMemoryReady();
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const bundle = memory.createBundle({
      name: body.name,
      version: body.version || undefined,
      description: body.description || undefined,
      project: body.project || undefined,
      nodeIds: Array.isArray(body.nodeIds) ? body.nodeIds : undefined,
      includeRelatedEdges: body.includeRelatedEdges,
    });

    return NextResponse.json(bundle, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
