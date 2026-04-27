import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/** POST /api/search */
export async function POST(request: NextRequest) {
  try {
    const memory = await getMemoryReady();
    const body = await request.json();

    const results = memory.queryGraphKnowledge(body.query, {
      project: body.project || undefined,
      topK: body.topK || 10,
      limit: body.topK || 10,
    });

    return NextResponse.json({ results, total: results.length });
  } catch (error) {
    return errorResponse(error);
  }
}
