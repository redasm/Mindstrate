import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import type { KnowledgeType } from '@mindstrate/server';

/** POST /api/search */
export async function POST(request: NextRequest) {
  try {
    const memory = await getMemoryReady();
    const body = await request.json();

    const results = await memory.search(body.query, {
      topK: body.topK || 10,
      filter: {
        language: body.language || undefined,
        framework: body.framework || undefined,
        types: body.type ? [body.type as KnowledgeType] : undefined,
        minScore: body.minScore,
      },
    });

    return NextResponse.json({ results, total: results.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
