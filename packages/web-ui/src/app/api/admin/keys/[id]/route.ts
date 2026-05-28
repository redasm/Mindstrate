import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { ADMIN_COOKIE_NAME, isAdminSession } from '@/lib/admin-session';

const requireAdmin = async (): Promise<NextResponse | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (!isAdminSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
};

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    const memory = await getMemoryReady();
    if (!memory.apiKeys.getById(id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const revoked = memory.apiKeys.revoke(id);
    return NextResponse.json({ revoked });
  } catch (error) {
    return errorResponse(error);
  }
}
