import { NextRequest, NextResponse } from 'next/server';
import type { SkillEvolutionPatchStatus } from '@mindstrate/protocol';
import { getMemory } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/** GET /api/skill-evolution - list skill evolution candidate patches */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;
    const project = params.get('project') || undefined;
    const status = (params.get('status') as SkillEvolutionPatchStatus | null) || undefined;
    const sourceNodeId = params.get('sourceNodeId') || undefined;
    const limit = parseInt(params.get('limit') || '50', 10);

    const patches = memory.metabolism.listSkillPatches({ project, status, sourceNodeId, limit });
    return NextResponse.json({ patches, total: patches.length });
  } catch (error) {
    return errorResponse(error);
  }
}
