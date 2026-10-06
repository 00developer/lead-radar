'use client';

import { useFormStatus } from 'react-dom';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { btn } from './ui';

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent" style={{ width: size, height: size }} aria-hidden="true" />;
}

/**
 * Submit button for any form that uses a Server Action (or next/form). While the form is being processed it is disabled
 * (so a second click cannot send it twice), shows a spinner and the `pendingLabel`, and for slow actions it can also show
 * a `note` that says how long to wait. It must sit inside the <form>.
 */
export function SubmitButton({
  children, pendingLabel, note, className = btn, ...rest
}: { children: ReactNode; pendingLabel?: string; note?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'>) {
  const { pending } = useFormStatus();
  return (
    <>
      <button {...rest} type="submit" className={className} disabled={pending || rest.disabled} aria-busy={pending}>
        {pending ? (
          <span className="inline-flex items-center gap-2">
            <Spinner />
            {pendingLabel ?? children}
          </span>
        ) : (
          children
        )}
      </button>
      {pending && note && (
        <span className="ml-1 text-sm font-medium" role="status">
          {note}
        </span>
      )}
    </>
  );
}
