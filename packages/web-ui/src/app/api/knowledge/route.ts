import { NextRequest, NextResponse } from 'next/server';
import { getMemory, getMemoryReady } from '@/lib/memory';
import { CaptureSource, isValidKnowledgeType, type KnowledgeType } from '@mindstrate/server';

/** GET /api/knowledge - 列出知识 */
export async function GET(request: NextRequest) {
  try {
    const memory = getMemory();
    const params = request.nextUrl.searchParams;

    const type = params.get('type') as KnowledgeType | null;
    const language = params.get('language');
    const limit = parseInt(params.get('limit') || '50', 10);

    const entries = memory.list(
      {
        types: type ? [type] : undefined,
        language: language || undefined,
      },
      limit,
    );

    return NextResponse.json({ entries, total: entries.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/** POST /api/knowledge - 添加知识 */
export async function POST(request: NextRequest) {
  try {
    const memory = await getMemoryReady();
    const body = await request.json();

    if (!body.title || !body.solution) {
      return NextResponse.json({ error: 'title and solution are required' }, { status: 400 });
    }
    if (body.type && !isValidKnowledgeType(body.type)) {
      return NextResponse.json({ error: `Invalid type: ${body.type}` }, { status: 400 });
    }

    const result = await memory.add({
      type: body.type || 'how_to',
      title: body.title,
      problem: body.problem || undefined,
      solution: body.solution,
      tags: body.tags || [],
      context: {
        language: body.language || undefined,
        framework: body.framework || undefined,
        project: body.project || undefined,
      },
      author: body.author || 'web-ui',
      source: CaptureSource.WEB_UI,
    });

    if (result.success) {
      return NextResponse.json({ success: true, knowledge: result.knowledge }, { status: 201 });
    } else {
      return NextResponse.json({ success: false, message: result.message, duplicateOf: result.duplicateOf });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
