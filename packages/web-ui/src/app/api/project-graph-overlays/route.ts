import { NextRequest, NextResponse } from 'next/server';
import { ProjectGraphOverlaySource } from '@mindstrate/protocol';
import { errorResponse } from '@/app/api/error-response';
import { getMemory } from '@/lib/memory';

export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;
    const overlays = memory.context.listProjectGraphOverlays({
      project: params.get('project') || undefined,
      target: params.get('target') || undefined,
      targetNodeId: params.get('targetNodeId') || undefined,
      targetEdgeId: params.get('targetEdgeId') || undefined,
      limit: parseInt(params.get('limit') || '100', 10),
    });
    return NextResponse.json({ overlays, total: overlays.length });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const memory = getMemory();
    const body = await request.json();
    if (!body.project || !body.kind || !body.content) {
      return NextResponse.json({ error: 'project, kind, and content are required' }, { status: 400 });
    }

    const overlay = memory.context.createProjectGraphOverlay({
      project: body.project,
      target: body.target || undefined,
      targetNodeId: body.targetNodeId || undefined,
      targetEdgeId: body.targetEdgeId || undefined,
      kind: body.kind,
      content: body.content,
      author: body.author || undefined,
      source: ProjectGraphOverlaySource.WEB,
    });
    return NextResponse.json({ overlay }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
