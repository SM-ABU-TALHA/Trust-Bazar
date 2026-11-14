import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

export interface ErrorStateProps {
  title: string;
  body: string;
  retry?: ReactNode;
  className?: string;
}

export function ErrorState({ title, body, retry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-xl border border-danger-100 bg-danger-50 px-6 py-10 text-center',
        className,
      )}
    >
      <h2 className="text-lg text-danger-700">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-700">{body}</p>
      {retry ? <div className="mt-4">{retry}</div> : null}
    </div>
  );
}

/** Small server wrapper that renders the translated error copy. */
export function TranslatedErrorState({ retry }: { retry?: ReactNode }) {
  const t = useTranslations('states');
  return <ErrorState title={t('errorTitle')} body={t('errorBody')} retry={retry} />;
}
