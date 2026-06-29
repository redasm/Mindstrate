import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { requireAdminFromRequest } from '@/lib/session';

/**
 * POST /api/admin/skill-evolution/prune-orphans
 * Delete skill-evolution patches whose source node no longer exists — the
 * orphans a full re-scan leaves behind. Admin-only and irreversible, so it is
 * never run automatically.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdminFromRequest(request);
  } catch (resp) {
    return resp as Response;
  }
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const project = typeof body.project === 'string' && body.project.trim() ? body.project.trim() : undefined;

    const memory = await getMemoryReady();
    const result = memory.metabolism.pruneOrphanedSkillPatches({ project });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
