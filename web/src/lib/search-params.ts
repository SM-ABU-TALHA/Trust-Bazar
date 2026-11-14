import type { SearchParamsInput } from './types';
import { CATEGORY_BY_SLUG, DISTRICT_NAMES } from './categories';
import { categoryObjectId } from './category-id';

export const CONDITION_VALUES = ['new', 'likeNew', 'good', 'refurbished', 'forParts'] as const;
export const SORT_VALUES = ['relevance', 'price_asc', 'price_desc', 'date_desc'] as const;

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface ParsedFilters {
  q?: string;
  categorySlug?: string;
  categoryId?: string;
  district?: string;
  condition?: string;
  minPrice?: number;
  maxPrice?: number;
  sort: (typeof SORT_VALUES)[number];
  page: number;
}

function first(value: string | string[] | undefined): string | undefined {
  const item = Array.isArray(value) ? value[0] : value;
  return item?.trim() || undefined;
}

function price(value: string | string[] | undefined): number | undefined {
  const raw = first(value);
  if (!raw) return undefined;
  const parsed = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.min(Math.round(parsed), 99_999_999);
}

export function parseFilters(raw: RawSearchParams): ParsedFilters {
  const q = first(raw.q)?.slice(0, 100);
  const slug = first(raw.category);
  const category = slug ? CATEGORY_BY_SLUG.get(slug) : undefined;
  const district = first(raw.district);
  const condition = first(raw.condition);
  const sort = first(raw.sort);
  const page = Number.parseInt(first(raw.page) ?? '1', 10);

  return {
    q,
    categorySlug: category ? slug : undefined,
    categoryId: category ? categoryObjectId(category.slug) : undefined,
    district: district && DISTRICT_NAMES.includes(district) ? district : undefined,
    condition:
      condition && (CONDITION_VALUES as readonly string[]).includes(condition)
        ? condition
        : undefined,
    minPrice: price(raw.minPrice),
    maxPrice: price(raw.maxPrice),
    sort: (SORT_VALUES as readonly string[]).includes(sort ?? '')
      ? (sort as (typeof SORT_VALUES)[number])
      : 'relevance',
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 500) : 1,
  };
}

/** Builds a query string, omitting empty/relevance defaults so URLs stay clean. */
export function buildQuery(filters: ParsedFilters, overrides: Partial<ParsedFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();

  if (merged.q) params.set('q', merged.q);
  if (merged.categorySlug) params.set('category', merged.categorySlug);
  if (merged.district) params.set('district', merged.district);
  if (merged.condition) params.set('condition', merged.condition);
  if (merged.minPrice !== undefined) params.set('minPrice', String(merged.minPrice));
  if (merged.maxPrice !== undefined) params.set('maxPrice', String(merged.maxPrice));
  if (merged.sort && merged.sort !== 'relevance') params.set('sort', merged.sort);
  if (merged.page && merged.page > 1) params.set('page', String(merged.page));

  const query = params.toString();
  return query ? `?${query}` : '';
}

export function toApiInput(filters: ParsedFilters): SearchParamsInput {
  return {
    q: filters.q,
    categoryId: filters.categoryId,
    district: filters.district,
    condition: filters.condition,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    sort: filters.sort,
    page: filters.page,
  };
}
