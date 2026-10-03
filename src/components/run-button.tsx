'use client';

import { useFormStatus } from 'react-dom';
import { btnPrimary } from './ui';

/** Submit button for "Run now": shows that the run is going on, because a run can take several minutes. */
export function RunButton() {
  const { pending } = useFormStatus();
  return (
    <>
      <button className={btnPrimary} type="submit" disabled={pending} aria-busy={pending}>
        {pending ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
            Running…
          </span>
        ) : (
          'Run now'
        )}
      </button>
      {pending && (
        <span className="ml-3 text-sm font-medium" role="status">
          Collecting and classifying posts. This takes a few minutes. Keep this tab open; the result appears here when it finishes.
        </span>
      )}
    </>
  );
}
