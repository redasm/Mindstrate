import { NextRequest, NextResponse } from 'next/server';
import { getMemory, getMemoryReady } from '@/lib/memory';

/** GET /api/knowledge/[id] */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const memory = getMemory();
    const knowledge = memory.get(id);

    if (!knowledge) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(knowledge);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

/** PUT /api/knowledge/[id] - 更新 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    const body = await request.json();

    const updated = await memory.updateAndReindex(id, {
      title: body.title,
      problem: body.problem,
      solution: body.solution,
      codeSnippets: body.codeSnippets,
      tags: body.tags,
      context: body.context,
      actionable: body.actionable,
      confidence: body.confidence,
    });

    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

/** DELETE /api/knowledge/[id] */
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    const deleted = await memory.delete(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

/** PATCH /api/knowledge/[id] - 投票 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const memory = getMemory();
    const body = await request.json();

    if (body.action === 'upvote') {
      memory.upvote(id);
    } else if (body.action === 'downvote') {
      memory.downvote(id);
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const updated = memory.get(id);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
