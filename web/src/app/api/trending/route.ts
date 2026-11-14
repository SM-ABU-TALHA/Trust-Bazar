import { NextResponse } from 'next/server';
import { getTrending } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Client-side trending refresh proxy (React Query). Keeps `API_BASE_URL`
 * server-only instead of exposing it to the browser bundle.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const district = searchParams.get('district') ?? undefined;
  const requested = Number.parseInt(searchParams.get('limit') ?? '12', 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 24) : 12;

  const items = await getTrending(district, limit);
  if (!items) {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  return NextResponse.json({ data: items });
}
