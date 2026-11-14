'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/states/error-state';

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('states');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title={t('errorTitle')}
      body={t('errorBody')}
      retry={<Button onClick={reset}>{t('retry')}</Button>}
    />
  );
}
