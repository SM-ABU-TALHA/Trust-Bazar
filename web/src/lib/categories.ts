import { CATEGORY_SEED, DISTRICTS } from '@trust/shared/constants';
import type { Locale } from './format';

export { CATEGORY_SEED };

export const CATEGORY_BY_SLUG = new Map(CATEGORY_SEED.map((category) => [category.slug, category]));

export const TOP_CATEGORIES = CATEGORY_SEED.filter((category) => !category.parentSlug);

export const DISTRICT_NAMES = DISTRICTS.map((district) => district.name);

export function districtOptions(locale: Locale): { value: string; label: string }[] {
  return DISTRICTS.map((district) => ({
    value: district.name,
    label: locale === 'bn' ? district.nameBn : district.name,
  }));
}

export function categoryName(
  category: { nameBn: string; nameEn: string },
  locale: Locale,
): string {
  return locale === 'bn' ? category.nameBn : category.nameEn;
}

export function districtLabel(name: string, locale: Locale): string {
  const district = DISTRICTS.find((item) => item.name === name);
  if (!district) return name;
  return locale === 'bn' ? district.nameBn : district.name;
}
