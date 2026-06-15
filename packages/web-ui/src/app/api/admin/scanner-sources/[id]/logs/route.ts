import { NextRequest, NextResponse } from 'next/server';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { requireAdminFromRequest } from '@/lib/session';

const guard = async (req: NextRequest): Promise<Response | null> => {
  try {
    await requireAdminFromRequest(req);
    return null;
  } catch (resp) {
    return resp as Response;
  }
};

const MAX_LIMIT = 1000;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    const source = memory.scanner.getSource(id);
    if (!source) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const requested = Number(request.nextUrl.searchParams.get('limit'));
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : 300;
    return NextResponse.json({ logs: memory.scanner.listLogs(id, limit) });
  } catch (error) {
    return errorResponse(error);
  }
}
