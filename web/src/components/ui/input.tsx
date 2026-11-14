import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  leading?: ReactNode;
}

export function Input({ label, hint, error, leading, id, name, className, ...props }: InputProps) {
  const inputId = id ?? name ?? 'input';
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-ink-700">
        {label}
      </label>
      <div className="relative">
        {leading ? (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-400">
            {leading}
          </span>
        ) : null}
        <input
          id={inputId}
          name={name}
          className={cn(
            'w-full rounded-lg border border-ink-300 bg-surface px-3 py-2.5 text-base text-ink-900',
            'placeholder:text-ink-400 focus:border-brand-600 focus:outline-none',
            leading ? 'pl-10' : undefined,
            error && 'border-danger-600',
            className,
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(hintId, errorId) || undefined}
          {...props}
        />
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
