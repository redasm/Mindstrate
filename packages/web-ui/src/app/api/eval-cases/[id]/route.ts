import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { requireAdminFromRequest } from '@/lib/session';

const guard = async (req: NextRequest): Promise<Response | null> => {
  try {
    await requireAdminFromRequest(req);
    return null;
  } catch (resp) {
    return resp as Response;
  }
};

/** DELETE /api/eval-cases/[id] - delete an eval case (admin) */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    const deleted = memory.evaluation.deleteEvalCase(id);
    return NextResponse.json({ deleted });
  } catch (error) {
    return errorResponse(error);
  }
}
