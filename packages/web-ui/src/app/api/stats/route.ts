import { NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

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
    return errorResponse(error);
  }
}
