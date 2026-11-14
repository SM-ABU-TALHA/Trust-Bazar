import { getTranslations } from 'next-intl/server';
import { CardGridSkeleton, Skeleton } from '@/components/ui/skeleton';

export default async function Loading() {
  const t = await getTranslations('states');

  return (
    <div className="space-y-8" aria-busy="true" aria-label={t('skeletonAria')}>
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <CardGridSkeleton count={6} />
    </div>
  );
}
