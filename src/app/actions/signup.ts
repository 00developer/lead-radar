'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '../../lib/app/server';
import { createSupabaseAdmin } from '../../lib/supabase/admin';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { attachInviteToWorkspace, claimInvite, releaseInvite } from '../../lib/phase4/invites';
import { createCustomerWorkspace } from '../../lib/phase4/workspaces';

const Input = z.object({
  token: z.string().min(20).max(100),
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10).max(72),
  accept: z.literal('on'),
});

function back(token: string, error: string): never {
  redirect(`/signup?token=${encodeURIComponent(token)}&error=${error}`);
}

/**
 * Invite-only signup. Order matters: claim the invite first (so a link works once), create the login, create the workspace.
 * If a later step fails the invite is given back and a half-made login is removed, so the person can simply try again.
 */
export async function signUp(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const parsed = Input.safeParse({
    token,
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    accept: formData.get('accept'),
  });
  if (!parsed.success) back(token, formData.get('accept') ? 'input' : 'terms');
  const v = parsed.data;

  const db = getDb();
  const invite = await claimInvite(db, v.token);
  if (!invite) back(token, 'invite');
  if (invite.email && invite.email !== v.email) {
    await releaseInvite(db, invite.id);
    back(token, 'email');
  }

  const admin = createSupabaseAdmin();
  const created = await admin.auth.admin.createUser({ email: v.email, password: v.password, email_confirm: true });
  if (created.error || !created.data.user) {
    await releaseInvite(db, invite.id);
    // One message for every failure, including "already registered": do not reveal which emails have accounts.
    back(token, 'create');
  }
  const userId = created.data.user.id;

  let failed = false;
  try {
    const workspaceId = await createCustomerWorkspace(db, { name: v.name, userId });
    await attachInviteToWorkspace(db, invite.id, workspaceId);
  } catch {
    failed = true;
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    await releaseInvite(db, invite.id);
  }
  if (failed) back(token, 'failed');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email: v.email, password: v.password });
  if (error) redirect('/login');
  redirect('/onboarding');
}
