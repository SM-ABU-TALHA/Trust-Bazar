/** Public API shapes used by the storefront (see API_spec.md §3). */

export interface ListingCard {
  id: string;
  title: string;
  price: number;
  condition: string;
  district: string | null;
  heroMediaUrl: string | null;
  boosted: boolean;
  createdAt: string | null;
}

export interface ListingMedia {
  id: string;
  url: string | null;
  width: number | null;
  height: number | null;
}

export interface ListingDetail {
  id: string;
  title: string;
  description: string;
  price: number;
  condition: string;
  status: string;
  categoryId: string;
  district: string | null;
  geo: { type: 'Point'; coordinates: [number, number] } | null;
  media: ListingMedia[];
  seller: {
    id: string;
    displayName: string | null;
    memberSince: string | null;
    verified: boolean;
  };
  stats: { views: number };
  boost: { active: boolean };
  aiScan: { status: string };
  expiresAt: string | null;
  createdAt: string | null;
}

export interface SearchResult {
  items: ListingCard[];
  page: number;
  limit: number;
  total: number;
  degraded: boolean;
}

export interface SearchParamsInput {
  q?: string;
  categoryId?: string;
  district?: string;
  minPrice?: number;
  maxPrice?: number;
  condition?: string;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'date_desc';
  page?: number;
  limit?: number;
}

export interface PriceBaseline {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  sampleSize: number;
  updatedAt: string | null;
}
