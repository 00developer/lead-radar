'use client';

import { btnPrimary, ErrorBanner } from '../../components/ui';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mt-8">
      <ErrorBanner>
        Something went wrong while loading this page. {process.env.NODE_ENV === 'development' ? error.message : 'Please try again.'}
      </ErrorBanner>
      <button className={btnPrimary} onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
