import type {
  ListingCard,
  ListingDetail,
  PriceBaseline,
  SearchParamsInput,
  SearchResult,
} from './types';

/**
 * Server-only data access for public pages. Never import this from a client
 * component (it reads server env and uses Next's fetch cache options).
 */
const API_BASE = (process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');

export type ApiFailure = { ok: false; kind: 'offline' | 'error' | 'notfound'; status?: number };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

interface RequestOptions {
  revalidate?: number;
  noStore?: boolean;
}

interface Envelope<T> {
  data: T;
  meta?: { page?: number; limit?: number; total?: number };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const cacheOptions: RequestInit = options.noStore
    ? { cache: 'no-store' }
    : { next: { revalidate: options.revalidate ?? 60 } };

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...cacheOptions,
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    });

    if (response.status === 404) return { ok: false, kind: 'notfound', status: 404 };
    if (!response.ok) return { ok: false, kind: 'error', status: response.status };

    const body = (await response.json()) as Envelope<T>;
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, kind: 'offline' };
  }
}

export async function getTrending(district?: string, limit = 12): Promise<ListingCard[] | null> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (district) params.set('district', district);

  const result = await request<ListingCard[]>(`/listings/trending?${params.toString()}`, {
    revalidate: 60,
  });
  return result.ok ? result.data : null;
}

export async function getListing(id: string): Promise<ApiResult<ListingDetail>> {
  return request<ListingDetail>(`/listings/${encodeURIComponent(id)}`, { revalidate: 300 });
}

export async function getPriceBaseline(
  categoryId: string,
  condition?: string,
): Promise<PriceBaseline | null> {
  const params = new URLSearchParams({ categoryId });
  if (condition) params.set('condition', condition);
  const result = await request<PriceBaseline | null>(
    `/listings/price-baseline?${params.toString()}`,
    { revalidate: 300 },
  );
  return result.ok ? result.data : null;
}

/** Search results with pagination meta and the API's degraded-mode flag. */
export async function searchListingsPage(
  input: SearchParamsInput,
): Promise<ApiResult<SearchResult>> {
  const params = new URLSearchParams();
  if (input.q) params.set('q', input.q);
  if (input.categoryId) params.set('categoryId', input.categoryId);
  if (input.district) params.set('district', input.district);
  if (input.minPrice !== undefined) params.set('minPrice', String(input.minPrice));
  if (input.maxPrice !== undefined) params.set('maxPrice', String(input.maxPrice));
  if (input.condition) params.set('condition', input.condition);
  if (input.sort) params.set('sort', input.sort);
  params.set('page', String(input.page ?? 1));
  params.set('limit', String(input.limit ?? 20));

  const cacheOptions: RequestOptions = input.q ? { noStore: true } : { revalidate: 60 };

  try {
    const response = await fetch(`${API_BASE}/listings/search?${params.toString()}`, {
      ...(cacheOptions.noStore ? { cache: 'no-store' } : { next: { revalidate: 60 } }),
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    });
    if (response.status === 404) return { ok: false, kind: 'notfound', status: 404 };
    if (!response.ok) return { ok: false, kind: 'error', status: response.status };

    const body = (await response.json()) as Envelope<ListingCard[]>;
    return {
      ok: true,
      data: {
        items: body.data,
        page: body.meta?.page ?? input.page ?? 1,
        limit: body.meta?.limit ?? input.limit ?? 20,
        total: body.meta?.total ?? body.data.length,
        degraded: response.headers.get('x-degraded') === 'search',
      },
    };
  } catch {
    return { ok: false, kind: 'offline' };
  }
}
