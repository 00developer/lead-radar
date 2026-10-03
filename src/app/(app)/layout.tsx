import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireSession } from '../../lib/auth';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { AppShell } from '../../components/app-shell';
import { getDb } from '../../lib/app/server';
import { isPlatformAdmin } from '../../lib/phase4/workspaces';

async function signOut() {
  'use server';
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  // Number shown next to "Leads" in the sidebar.
  const { count } = await s.supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', s.workspaceId)
    .eq('status', 'new');
  // Only used to show the Admin link. The Admin page and its actions check again on the server.
  const isAdmin = await isPlatformAdmin(getDb(), s.userId).catch(() => false);
  return (
    <AppShell workspaceName={s.workspaceName} email={s.email} newLeads={count ?? 0} isAdmin={isAdmin} signOut={signOut}>
      {children}
    </AppShell>
  );
}
