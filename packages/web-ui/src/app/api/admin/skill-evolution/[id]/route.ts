import { NextRequest, NextResponse } from 'next/server';
import type {
  SkillEvolutionEvaluator,
  SkillEvolutionMetric,
} from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { requireAdminFromRequest } from '@/lib/session';

const guard = (req: NextRequest): Response | null => {
  try {
    requireAdminFromRequest(req);
    return null;
  } catch (resp) {
    return resp as Response;
  }
};

/** POST /api/admin/skill-evolution/[id]?action=evaluate|reject */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(request); if (denied) return denied;
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
      const rejected = memory.metabolism.rejectSkillPatch({ patchId: id, reason });
      return NextResponse.json(rejected);
    }

    if (action === 'evaluate') {
      const baselineScore = body.baselineScore;
      const candidateScore = body.candidateScore;
      if (typeof baselineScore !== 'number' || typeof candidateScore !== 'number') {
        return NextResponse.json({ error: 'baselineScore and candidateScore are required numbers' }, { status: 400 });
      }
      const evaluation = memory.evaluation.evaluateSkillPatchScoreGate({
        patchId: id,
        evaluator: (body.evaluator as SkillEvolutionEvaluator) ?? ('retrieval' as SkillEvolutionEvaluator),
        metric: (body.metric as SkillEvolutionMetric) ?? ('f1' as SkillEvolutionMetric),
        baselineScore,
        candidateScore,
        details: { source: 'web-ui' },
      });
      return NextResponse.json(evaluation);
    }

    return NextResponse.json({ error: 'action must be evaluate or reject' }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
