import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button, buttonClass } from '@/components/ui/button';
import { CATEGORY_SEED, categoryName, districtOptions } from '@/lib/categories';
import { CONDITION_VALUES, SORT_VALUES, type ParsedFilters } from '@/lib/search-params';
import type { Locale } from '@/lib/format';

const FIELD =
  'w-full rounded-lg border border-ink-300 bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand-600 focus:outline-none';

const SORT_LABEL_KEYS = {
  relevance: 'search.sortRelevance',
  price_asc: 'search.sortPriceAsc',
  price_desc: 'search.sortPriceDesc',
  date_desc: 'search.sortDateDesc',
} as const;

export function SearchFilters({
  filters,
  locale,
}: {
  filters: ParsedFilters;
  locale: Locale;
}) {
  const t = useTranslations();

  return (
    <form
      action={`/${locale}/search`}
      method="get"
      className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4"
    >
      <label className="space-y-1 text-sm lg:col-span-2">
        <span className="font-medium text-ink-700">{t('search.queryLabel')}</span>
        <input
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder={t('search.placeholder')}
          className={FIELD}
        />
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium text-ink-700">{t('search.categoryLabel')}</span>
        <select name="category" defaultValue={filters.categorySlug ?? ''} className={FIELD}>
          <option value="">{t('search.anyCategory')}</option>
          {CATEGORY_SEED.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.parentSlug ? '— ' : ''}
              {categoryName(category, locale)}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium text-ink-700">{t('search.districtLabel')}</span>
        <select name="district" defaultValue={filters.district ?? ''} className={FIELD}>
          <option value="">{t('search.anyDistrict')}</option>
          {districtOptions(locale).map((district) => (
            <option key={district.value} value={district.value}>
              {district.label}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium text-ink-700">{t('search.conditionLabel')}</span>
        <select name="condition" defaultValue={filters.condition ?? ''} className={FIELD}>
          <option value="">{t('search.anyCondition')}</option>
          {CONDITION_VALUES.map((condition) => (
            <option key={condition} value={condition}>
              {t(`conditions.${condition}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium text-ink-700">{t('search.minPrice')}</span>
        <input
          type="number"
          name="minPrice"
          min={0}
          max={99_999_999}
          defaultValue={filters.minPrice}
          className={FIELD}
        />
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium text-ink-700">{t('search.maxPrice')}</span>
        <input
          type="number"
          name="maxPrice"
          min={0}
          max={99_999_999}
          defaultValue={filters.maxPrice}
          className={FIELD}
        />
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium text-ink-700">{t('search.sortLabel')}</span>
        <select name="sort" defaultValue={filters.sort} className={FIELD}>
          {SORT_VALUES.map((sort) => (
            <option key={sort} value={sort}>
              {t(SORT_LABEL_KEYS[sort])}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="sm">
          {t('search.apply')}
        </Button>
        <Link href="/search" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
          {t('search.reset')}
        </Link>
      </div>
    </form>
  );
}
