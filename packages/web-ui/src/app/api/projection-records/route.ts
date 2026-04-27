import { NextRequest, NextResponse } from 'next/server';
import { getMemory } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';

/** GET /api/projection-records - list ECS projection materialization records */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;
    const nodeId = params.get('nodeId') || undefined;
    const target = params.get('target') || undefined;
    const limit = parseInt(params.get('limit') || '20', 10);

    const records = memory.listProjectionRecords({ nodeId, target, limit });
    return NextResponse.json({ records, total: records.length });
  } catch (error) {
    return errorResponse(error);
  }
}
