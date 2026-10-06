'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { btn } from './ui';
import { Spinner } from './submit-button';

const STALE_AFTER_MIN = 10;

/**
 * "Updated 18:42:10" with a Refresh button. The page is built on the server when it is opened and never refreshes by itself,
 * so a tab that stays open shows old data. This line makes that visible: after 10 minutes it turns into a warning.
 */
export function PageStamp({ at }: { at: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [at]);

  const d = new Date(at);
  const minutes = Math.max(0, Math.floor((now - d.getTime()) / 60_000));
  const stale = minutes >= STALE_AFTER_MIN;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" aria-live="polite">
      <span className={stale ? 'font-medium text-(--warn)' : 'text-(--muted)'}>
        {/* The server renders in UTC; the browser re-renders in the viewer's time zone (same idea as LocalTime). */}
        Updated <time dateTime={d.toISOString()} suppressHydrationWarning>{d.toLocaleTimeString()}</time>
        {minutes >= 1 ? <span suppressHydrationWarning> · {minutes} min ago</span> : null}
        {stale ? ' · this page may be out of date' : ''}
      </span>
      <button type="button" className={btn} onClick={() => startRefresh(() => router.refresh())} disabled={refreshing} aria-busy={refreshing}>
        {refreshing ? (
          <span className="inline-flex items-center gap-2">
            <Spinner /> Refreshing…
          </span>
        ) : (
          'Refresh'
        )}
      </button>
    </div>
  );
}
