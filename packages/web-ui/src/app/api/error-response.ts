import { NextResponse } from 'next/server';

export function errorResponse(error: unknown): NextResponse {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Unknown error' },
    { status: 500 },
  );
}
