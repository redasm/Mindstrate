import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { requireAdminFromRequest } from '@/lib/session';

/**
 * POST /api/admin/skill-evolution/optimize
 * Run the SkillOpt-style optimizer over low-adoption / negative-feedback
 * skill nodes. Explicitly admin-triggered — the optimizer spends LLM calls,
 * so it never runs on the metabolism schedule.
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
    const limit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : undefined;

    const memory = await getMemoryReady();
    const results = await memory.metabolism.optimizeSkillTargets({ project, limit });
    return NextResponse.json({ results, total: results.length });
  } catch (error) {
    return errorResponse(error);
  }
}
