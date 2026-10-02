import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireSession } from '../../lib/auth';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { AppShell } from '../../components/app-shell';

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
  return (
    <AppShell workspaceName={s.workspaceName} email={s.email} newLeads={count ?? 0} signOut={signOut}>
      {children}
    </AppShell>
  );
}
