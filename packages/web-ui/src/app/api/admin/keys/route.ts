import { NextRequest, NextResponse } from 'next/server';
import type { ApiKeyScope } from '@mindstrate/protocol';
import { cookies } from 'next/headers';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { ADMIN_COOKIE_NAME, isAdminSession } from '@/lib/admin-session';

const VALID_SCOPES: ApiKeyScope[] = ['read', 'write', 'admin'];

const requireAdmin = async (): Promise<NextResponse | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (!isAdminSession(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
};

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const memory = await getMemoryReady();
    return NextResponse.json({ keys: memory.apiKeys.listActive() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const rawScopes = Array.isArray(body.scopes) ? body.scopes : [];
    const scopes: ApiKeyScope[] = [];
    for (const value of rawScopes) {
      if (typeof value !== 'string' || !VALID_SCOPES.includes(value as ApiKeyScope)) {
        return NextResponse.json({ error: 'scopes must be a non-empty array of read|write|admin' }, { status: 400 });
      }
      if (!scopes.includes(value as ApiKeyScope)) scopes.push(value as ApiKeyScope);
    }
    if (scopes.length === 0) {
      return NextResponse.json({ error: 'scopes must be a non-empty array of read|write|admin' }, { status: 400 });
    }
    const rawProjects = Array.isArray(body.projects) ? body.projects : [];
    const projects: string[] = [];
    for (const value of rawProjects) {
      if (typeof value !== 'string' || value.trim() === '') {
        return NextResponse.json({ error: 'projects must be a non-empty array of strings (use "*" for wildcard)' }, { status: 400 });
      }
      projects.push(value.trim());
    }
    if (projects.length === 0) {
      return NextResponse.json({ error: 'projects must be a non-empty array of strings (use "*" for wildcard)' }, { status: 400 });
    }

    const memory = await getMemoryReady();
    const created = memory.apiKeys.create({ name, scopes, projects, createdBy: 'web-admin' });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
