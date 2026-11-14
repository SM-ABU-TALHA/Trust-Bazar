import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** No-JS GET form — search works before hydration (NFR-10). */
export function SearchBar({ locale, defaultQuery }: { locale: string; defaultQuery?: string }) {
  const t = useTranslations('search');

  return (
    <form action={`/${locale}/search`} method="get" role="search" className="flex w-full gap-2">
      <label htmlFor="site-search" className="sr-only">
        {t('placeholder')}
      </label>
      <input
        id="site-search"
        name="q"
        type="search"
        defaultValue={defaultQuery}
        placeholder={t('placeholder')}
        className="min-w-0 flex-1 rounded-lg border border-ink-300 bg-surface px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
      />
      <Button type="submit" size="sm">
        {t('submit')}
      </Button>
    </form>
  );
}

export function HomeSearchBar({ locale, placeholder }: { locale: string; placeholder: string }) {
  const t = useTranslations('search');

  return (
    <form action={`/${locale}/search`} method="get" role="search" className="flex w-full gap-2">
      <label htmlFor="home-search" className="sr-only">
        {t('placeholder')}
      </label>
      <input
        id="home-search"
        name="q"
        type="search"
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg border border-ink-300 bg-surface px-4 py-3 text-base text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-lg bg-brand-700 px-5 py-3 text-sm font-medium text-white hover:bg-brand-800"
      >
        {t('submit')}
      </button>
    </form>
  );
}
