'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { IconChart, IconClose, IconKeywords, IconLeads, IconLogout, IconMenu, IconOverview, IconProfile, IconSettings, IconSources, LogoMark } from './icons';

const NAV = [
  { href: '/', label: 'Overview', icon: IconOverview, group: 'Workspace' },
  { href: '/leads', label: 'Leads', icon: IconLeads, group: 'Workspace', badge: true },
  { href: '/keywords', label: 'Keywords', icon: IconKeywords, group: 'Workspace' },
  { href: '/insights', label: 'Insights', icon: IconChart, group: 'Workspace' },
  { href: '/sources', label: 'Sources & Runs', icon: IconSources, group: 'Automation' },
  { href: '/profile', label: 'Business Profile', icon: IconProfile, group: 'Automation' },
  { href: '/settings', label: 'Settings', icon: IconSettings, group: 'Account' },
];

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}

export function AppShell({
  children, workspaceName, email, newLeads, signOut,
}: {
  children: ReactNode; workspaceName: string; email: string | null; newLeads: number; signOut: () => Promise<void>;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]); // close the drawer after navigating on phones

  const groups = [...new Set(NAV.map((n) => n.group))];
  const initial = (email ?? workspaceName)[0]?.toUpperCase() ?? '?';

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <LogoMark />
        <div className="min-w-0 leading-tight">
          <p className="text-[1.02rem] font-semibold tracking-tight">Lead Radar</p>
          <p className="truncate text-xs text-(--muted)">{workspaceName}</p>
        </div>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {groups.map((g) => (
          <div key={g}>
            <p className="mb-2 px-3 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-(--muted) opacity-80">{g}</p>
            <ul className="space-y-1">
              {NAV.filter((n) => n.group === g).map((n) => {
                const Icon = n.icon;
                const active = isActive(path, n.href);
                return (
                  <li key={n.href}>
                    <Link href={n.href} className="nav-link" aria-current={active ? 'page' : undefined}>
                      <Icon width={19} height={19} />
                      <span className="flex-1">{n.label}</span>
                      {n.badge && newLeads > 0 && (
                        <span className="grad-bg rounded-full px-2 py-0.5 text-[0.68rem] font-semibold tabular-nums text-white">{newLeads > 99 ? '99+' : newLeads}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="m-3 rounded-2xl border border-(--border) bg-(--surface-2) p-3">
        <div className="flex items-center gap-3">
          <span className="grad-bg grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-semibold text-white">{initial}</span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium">{email ?? 'Signed in'}</p>
            <p className="text-xs text-(--muted)">Owner</p>
          </div>
        </div>
        <form action={signOut} className="mt-3">
          <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-lg border border-(--border) px-3 py-1.5 text-sm text-(--muted) transition hover:border-(--bad) hover:text-(--bad)">
            <IconLogout width={16} height={16} /> Sign out
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="app-bg min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-(--border) bg-(--sidebar) lg:block">{sidebar}</aside>

      {/* Phone top bar and drawer */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-(--border) bg-(--sidebar)/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          <LogoMark size={30} />
          <span className="font-semibold tracking-tight">Lead Radar</span>
        </div>
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="grid h-9 w-9 place-items-center rounded-lg border border-(--border)">
          <IconMenu />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] border-r border-(--border) bg-(--sidebar)">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-4 grid h-8 w-8 place-items-center rounded-lg text-(--muted) hover:bg-(--neutral-bg)">
              <IconClose width={18} height={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <main className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6 lg:px-10 lg:pt-10">{children}</main>
      </div>
    </div>
  );
}
