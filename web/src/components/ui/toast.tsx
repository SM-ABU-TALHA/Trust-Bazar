'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

export type ToastVariant = 'info' | 'success' | 'error';

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastContextValue {
  push: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 4000;

const VARIANTS: Record<ToastVariant, string> = {
  info: 'border-ink-200 bg-surface text-ink-900',
  success: 'border-success-600/40 bg-success-50 text-success-700',
  error: 'border-danger-600/40 bg-danger-50 text-danger-700',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);

  const push = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setItems((previous) => [...previous.slice(-2), { ...toast, id }]);

    const timer = window.setTimeout(() => {
      setItems((previous) => previous.filter((item) => item.id !== id));
    }, TOAST_DURATION_MS);
    timers.current.push(timer);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto w-full rounded-lg border px-4 py-3 shadow-raised',
              VARIANTS[item.variant ?? 'info'],
            )}
          >
            <p className="text-sm font-semibold">{item.title}</p>
            {item.description ? <p className="mt-0.5 text-xs opacity-80">{item.description}</p> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
