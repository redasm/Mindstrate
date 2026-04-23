import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';

/** POST /api/bundles/validate - validate a portable ECS context bundle */
export async function POST(request: NextRequest) {
  try {
    const memory = await getMemoryReady();
    const body = await request.json();

    if (!body.bundle) {
      return NextResponse.json({ error: 'bundle is required' }, { status: 400 });
    }

    const result = memory.validateBundle(body.bundle);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
