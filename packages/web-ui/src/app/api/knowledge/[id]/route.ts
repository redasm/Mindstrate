import { NextRequest, NextResponse } from 'next/server';
import { getMemory } from '@/lib/memory';
import { toGraphKnowledgeView, type ContextNode } from '@mindstrate/server';
import { errorResponse } from '@/app/api/error-response';
import { canAccessProject, requireSessionFromRequest, type SessionPayload } from '@/lib/session';

const guard = async (req: NextRequest): Promise<{ session: SessionPayload } | { denied: Response }> => {
  try {
    return { session: await requireSessionFromRequest(req) };
  } catch (resp) {
    return { denied: resp as Response };
  }
};

/** 404 for both missing nodes and nodes outside the member's projects, so ids don't leak. */
const findAccessibleNode = (session: SessionPayload, id: string): ContextNode | null => {
  const node = getMemory().context.getContextNode(id);
  if (!node) return null;
  if (node.project && !canAccessProject(session, node.project)) return null;
  return node;
};

/** GET /api/knowledge/[id] */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(request);
  if ('denied' in auth) return auth.denied;
  try {
    const { id } = await params;
    const node = findAccessibleNode(auth.session, id);
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
  const auth = await guard(request);
  if ('denied' in auth) return auth.denied;
  try {
    const { id } = await params;
    if (!findAccessibleNode(auth.session, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await request.json();

    const updated = getMemory().context.updateContextNode(id, {
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
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(request);
  if ('denied' in auth) return auth.denied;
  try {
    const { id } = await params;
    if (!findAccessibleNode(auth.session, id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const deleted = getMemory().context.deleteContextNode(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
