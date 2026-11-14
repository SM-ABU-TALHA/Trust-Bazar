import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-surface-muted px-6 py-14 text-center',
        className,
      )}
    >
      {icon ? <div className="mb-3 text-ink-400">{icon}</div> : null}
      <h2 className="text-lg text-ink-900">{title}</h2>
      {description ? <p className="mt-1 max-w-md text-sm text-ink-600">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
