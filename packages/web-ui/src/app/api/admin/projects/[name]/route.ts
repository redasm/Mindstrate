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
 * Permanently delete a project: its vectors, all of its context-graph rows, and
 * its scan-source configs (so it isn't rebuilt on the next scan). Admin only,
 * irreversible.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const { name } = await params;
    const project = decodeURIComponent(name).trim();
    if (!project) {
      return NextResponse.json({ error: 'project name is required' }, { status: 400 });
    }
    const memory = await getMemoryReady();
    const result = await memory.maintenance.deleteProject(project);
    return NextResponse.json({ project, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
