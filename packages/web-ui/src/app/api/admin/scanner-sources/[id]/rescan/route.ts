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

/**
 * POST /api/admin/scanner-sources/:id/rescan
 *
 * Queue a from-scratch re-scan: clears the project's existing
 * scanner-extracted graph nodes (so files removed since the last scan don't
 * linger as orphans, and the P4 path doesn't skip re-indexing), then resets
 * the source cursor so the repo-scanner daemon treats its next run as a first
 * run (full re-index). Manually-authored knowledge is preserved. The scan
 * itself runs on the daemon's next tick; this only flips the state.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    const result = memory.scanner.rescanFromScratch(id);
    if (!result) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ queued: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
