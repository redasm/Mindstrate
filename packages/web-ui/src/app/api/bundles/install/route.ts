import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/** POST /api/bundles/install - install a portable ECS context bundle */
export async function POST(request: NextRequest) {
  try {
    const memory = await getMemoryReady();
    const body = await request.json();

    if (!body.bundle && (!body.registry || !body.reference)) {
      return NextResponse.json({ error: 'bundle or registry plus reference is required' }, { status: 400 });
    }

    const result = body.bundle
      ? memory.bundles.installBundle(body.bundle)
      : await memory.bundles.installBundleFromRegistry({
          registry: body.registry,
          reference: body.reference,
        });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
