import { NextRequest, NextResponse } from 'next/server';
import type { ApiKeyScope } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { errorResponse } from '@/app/api/error-response';
import { requireAdminFromRequest } from '@/lib/session';

const VALID_SCOPES: ApiKeyScope[] = ['read', 'write', 'admin'];

export async function GET(req: NextRequest) {
  try {
    requireAdminFromRequest(req);
  } catch (resp) {
    return resp as Response;
  }
  try {
    const memory = await getMemoryReady();
    return NextResponse.json({ keys: memory.apiKeys.listAll() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAdminFromRequest(req);
  } catch (resp) {
    return resp as Response;
  }
  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const memory = await getMemoryReady();
    if (memory.apiKeys.findActiveByName(name)) {
      return NextResponse.json({ error: 'A user with this name already exists' }, { status: 409 });
    }

    const scopes: ApiKeyScope[] = ['read', 'write'];
    const rawScopes = Array.isArray(body.scopes) ? body.scopes : null;
    if (rawScopes) {
      const filtered = rawScopes.filter(
        (s: unknown): s is ApiKeyScope => typeof s === 'string' && VALID_SCOPES.includes(s as ApiKeyScope),
      );
      if (filtered.length > 0) scopes.splice(0, scopes.length, ...filtered);
    }

    const rawProjects = Array.isArray(body.projects) ? body.projects : [];
    const projects: string[] = rawProjects
      .filter((p: unknown): p is string => typeof p === 'string' && p.trim() !== '')
      .map((p: string) => p.trim());
    if (projects.length === 0) {
      return NextResponse.json(
        { error: 'Members must have at least one project' },
        { status: 400 },
      );
    }

    const created = memory.apiKeys.create({ name, role: 'member', scopes, projects, createdBy: 'web-admin' });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
