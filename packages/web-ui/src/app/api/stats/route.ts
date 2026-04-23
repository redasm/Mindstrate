import { NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';

/** GET /api/stats */
export async function GET() {
  try {
    const memory = await getMemoryReady();
    const stats = await memory.getStats();

    return NextResponse.json({
      total: stats.total,
      vectorCount: stats.vectorCount,
      byType: stats.byType,
      byStatus: stats.byStatus,
      byLanguage: stats.byLanguage,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
