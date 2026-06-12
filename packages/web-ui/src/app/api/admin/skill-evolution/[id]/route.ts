import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { requireAdminFromRequest, type SessionPayload } from '@/lib/session';

const guard = async (req: NextRequest): Promise<{ session: SessionPayload } | { denied: Response }> => {
  try {
    return { session: await requireAdminFromRequest(req) };
  } catch (resp) {
    return { denied: resp as Response };
  }
};

/** POST /api/admin/skill-evolution/[id]?action=approve|reject */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(request);
  if ('denied' in auth) return auth.denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    const patch = memory.metabolism.getSkillPatch(id);
    if (!patch) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const action = request.nextUrl.searchParams.get('action');
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;

    if (action === 'reject') {
      const reason = typeof body.reason === 'string' ? body.reason : '';
      if (!reason) return NextResponse.json({ error: 'reason is required' }, { status: 400 });
      const rejected = memory.metabolism.rejectSkillPatch({
        patchId: id,
        reason,
        metadata: { decidedBy: 'manual-review', rejectedBy: auth.session.name },
      });
      return NextResponse.json(rejected);
    }

    if (action === 'approve') {
      const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined;
      const approved = memory.metabolism.approveSkillPatch({
        patchId: id,
        approvedBy: auth.session.name,
        note,
      });
      return NextResponse.json(approved);
    }

    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
