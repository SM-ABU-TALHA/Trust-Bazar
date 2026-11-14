'use client';

import { useEffect, useState } from 'react';

export interface OfflineBannerProps {
  title: string;
  body: string;
}

/** Listens for browser connectivity events and surfaces NFR-10 offline state. */
export function OfflineBanner({ title, body }: OfflineBannerProps) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div role="alert" className="bg-accent-500 px-4 py-2 text-center text-sm text-ink-900">
      <strong className="font-semibold">{title}</strong> <span>{body}</span>
    </div>
  );
}
