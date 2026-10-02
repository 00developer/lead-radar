import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from './supabase/server';

export type Session = {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  email: string | null;
  workspaceId: string;
  workspaceName: string;
  role: string;
};

/**
 * Verifies the session (signature checked with getClaims) and finds the user's workspace through RLS.
 * Every page and every Server Action calls this first, because Server Actions can be posted to directly.
 */
export async function requireSession(): Promise<Session> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect('/login');

  const { data: member } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces(name)')
    .eq('user_id', claims.sub)
    .order('workspace_id')
    .limit(1)
    .maybeSingle();
  if (!member) redirect('/login?error=no-workspace');

  const ws = member.workspaces as unknown as { name: string } | null;
  return {
    supabase,
    userId: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    workspaceId: member.workspace_id,
    workspaceName: ws?.name ?? 'Workspace',
    role: member.role,
  };
}
