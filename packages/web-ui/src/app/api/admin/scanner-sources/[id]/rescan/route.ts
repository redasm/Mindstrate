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
 * Queue a from-scratch re-scan: clears the source's cursor so the repo-scanner
 * daemon treats its next run as a first run (full project-graph re-index). With
 * `{ wipe: true }` the project's existing scanner-extracted graph nodes are
 * deleted first so files removed since the last scan don't linger as orphans.
 * The scan itself runs on the daemon's next tick; this only flips the state.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const wipeGraph = body.wipe === true;
    const result = memory.scanner.rescanFromScratch(id, { wipeGraph });
    if (!result) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ queued: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
