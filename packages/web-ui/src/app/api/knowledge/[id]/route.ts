import { NextRequest, NextResponse } from 'next/server';
import { getMemory } from '@/lib/memory';
import { toGraphKnowledgeView } from '@mindstrate/server';
import { errorResponse } from '@/app/api/error-response';

/** GET /api/knowledge/[id] */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const memory = getMemory();
    const node = memory.queryContextGraph({ query: id, limit: 50 }).find((item) => item.id === id);

    if (!node) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(toGraphKnowledgeView(node));
  } catch (error) {
    return errorResponse(error);
  }
}

/** PUT /api/knowledge/[id] - 更新 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const memory = getMemory();
    const body = await request.json();

    const updated = memory.updateContextNode(id, {
      title: body.title,
      content: body.summary ?? body.content,
      tags: body.tags,
      confidence: body.confidence,
    });

    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(toGraphKnowledgeView(updated));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/knowledge/[id] */
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const memory = getMemory();
    const deleted = memory.deleteContextNode(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

/** PATCH /api/knowledge/[id] - retained endpoint, returns the ECS node view */
export async function PATCH(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const memory = getMemory();
    const node = memory.queryContextGraph({ query: id, limit: 50 }).find((item) => item.id === id);
    return NextResponse.json(node ? toGraphKnowledgeView(node) : null);
  } catch (error) {
    return errorResponse(error);
  }
}
