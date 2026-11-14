import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-ink-200', className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={index === lines - 1 ? 'h-3 w-2/3' : 'h-3 w-full'}
        />
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <Skeleton className="mb-3 aspect-[4/3] w-full" />
          <Skeleton className="mb-2 h-4 w-5/6" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ))}
    </div>
  );
}
