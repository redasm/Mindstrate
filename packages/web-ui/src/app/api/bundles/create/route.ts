import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
