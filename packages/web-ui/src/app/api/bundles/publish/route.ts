import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/** POST /api/bundles/publish - prepare a portable ECS context bundle for distribution */
export async function POST(request: NextRequest) {
  try {
    const memory = await getMemoryReady();
    const body = await request.json();

    if (!body.bundle) {
      return NextResponse.json({ error: 'bundle is required' }, { status: 400 });
    }

    const result = memory.bundles.publishBundle(body.bundle, {
      registry: body.registry || undefined,
      visibility: body.visibility || undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
