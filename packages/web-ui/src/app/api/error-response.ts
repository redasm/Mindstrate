import { NextResponse } from 'next/server';
import { errorMessage } from '@mindstrate/protocol/text';

export function errorResponse(error: unknown): NextResponse {
  return NextResponse.json(
    { error: errorMessage(error) },
    { status: 500 },
  );
}
