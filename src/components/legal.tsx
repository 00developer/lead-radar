// Shared frame for the public legal pages (privacy, terms, data deletion). Plain text, no login needed.

import type { ReactNode } from 'react';
import { LogoMark } from './icons';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="app-bg min-h-screen px-5 py-12">
      <main className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark size={36} />
          <span className="text-lg font-semibold tracking-tight">Lead Radar</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-(--muted)">Last updated: {updated}</p>
        <div className="mt-8 space-y-6 text-[15px] leading-relaxed [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">{children}</div>
      </main>
    </div>
  );
}

/** Public contact address, set with CONTACT_EMAIL. Falls back to a plain sentence so no address is invented. */
export function contactLine(): string {
  const email = process.env.CONTACT_EMAIL?.trim();
  return email ? `Write to ${email}.` : 'Contact the person or company that gave you access to this app.';
}
