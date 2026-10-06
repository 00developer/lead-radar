'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Spinner } from './submit-button';

/** Plain link to a route that sends the browser away (Threads sign-in). Shows that something is happening and ignores a second click. */
export function BusyLink({ href, className, busyLabel, children }: { href: string; className: string; busyLabel: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  // Coming back with the browser's back button restores this page from memory: clear the busy state then.
  useEffect(() => {
    const reset = () => setBusy(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  return (
    <a
      href={href}
      className={`${className} ${busy ? 'pointer-events-none opacity-80' : ''}`}
      aria-busy={busy}
      onClick={(e) => {
        if (busy) e.preventDefault();
        else setBusy(true);
      }}
    >
      {busy ? (
        <span className="inline-flex items-center gap-2">
          <Spinner /> {busyLabel}
        </span>
      ) : (
        children
      )}
    </a>
  );
}

/**
 * Downloads a file from `href` with a visible "preparing" state. A plain download link gives no sign while the server builds the
 * file; this fetches it, shows a spinner, then saves it, and reports a problem (for example an expired login) on the page.
 */
export function DownloadButton({ href, className, busyLabel, children }: { href: string; className: string; busyLabel: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(href, { credentials: 'same-origin' });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || res.redirected || !type.includes('spreadsheetml')) {
        throw new Error(res.redirected || res.status === 401 ? 'Your session ended. Please sign in again.' : `The file could not be created (error ${res.status}).`);
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'lead-radar.xlsx';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The download failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={download} disabled={busy} aria-busy={busy}>
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <Spinner /> {busyLabel}
          </span>
        ) : (
          children
        )}
      </button>
      {error && (
        <span role="alert" className="text-sm font-medium text-(--bad)">
          {error}
        </span>
      )}
    </>
  );
}
