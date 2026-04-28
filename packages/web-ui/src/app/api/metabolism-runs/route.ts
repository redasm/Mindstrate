import { NextRequest, NextResponse } from 'next/server';
import { getMemory } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/** GET /api/metabolism-runs - list recent ECS metabolism runs */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;
    const project = params.get('project') || undefined;
    const limit = parseInt(params.get('limit') || '10', 10);

    const runs = memory.metabolism.listMetabolismRuns(project, limit);
    return NextResponse.json({ runs, total: runs.length });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/metabolism-runs - trigger an ECS metabolism run */
export async function POST(request: NextRequest) {
  try {
    const memory = getMemory();
    const body = await request.json().catch(() => ({}));
    if (body.stage) {
      const options = { project: body.project || undefined };
      const result = body.stage === 'digest'
        ? memory.metabolism.runDigest(options)
        : body.stage === 'assimilate'
          ? memory.metabolism.runAssimilation(options)
          : body.stage === 'compress'
            ? await memory.metabolism.runCompression(options)
            : body.stage === 'prune'
              ? memory.metabolism.runPruning(options)
              : body.stage === 'reflect'
                ? memory.metabolism.runReflection(options)
                : null;

      if (!result) {
        return NextResponse.json({ error: 'stage must be digest, assimilate, compress, prune, or reflect' }, { status: 400 });
      }
      return NextResponse.json(result, { status: 201 });
    }

    const run = await memory.metabolism.runMetabolism({
      project: body.project || undefined,
      trigger: body.trigger || 'manual',
    });
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
