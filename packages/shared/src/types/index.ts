import type { ErrorType } from '../constants/index.js';

export * from './models.js';

export interface ApiMeta {
  requestId?: string;
  page?: number;
  limit?: number;
  total?: number;
}

export interface ApiResponse<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ApiFieldError {
  field: string;
  code: string;
  message: string;
}

/** RFC-7807 problem+json body. */
export interface ApiErrorBody {
  type: ErrorType | string;
  title: string;
  status: number;
  detail?: string;
  requestId: string;
  errors?: ApiFieldError[];
  retryable: boolean;
}

export type Paginated<T> = ApiResponse<T[]> & {
  meta: ApiMeta & { page: number; limit: number; total: number };
};
