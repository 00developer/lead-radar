'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { requireSession } from '../../lib/auth';
import { getDb } from '../../lib/app/server';
import { supabaseConfig } from '../../lib/supabase/config';
import { createSupabaseAdmin } from '../../lib/supabase/admin';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { canDeleteAccount, deleteWorkspaceIfEmpty, typedWordMatches } from '../../lib/phase4/account';

function back(error: string): never {
  redirect(`/settings?error=${encodeURIComponent(error)}#delete-account`);
}

/**
 * Deletes the signed-in user's own account. Needs the password again and the word DELETE, because it cannot be undone.
 * The password is checked with a throw-away client, so the current session cookies are not touched.
 */
export async function deleteMyAccount(formData: FormData) {
  const s = await requireSession();
  if (!s.email) back('Could not confirm your email address. Sign out and sign in again.');
  if (!typedWordMatches(String(formData.get('confirm') ?? ''))) back('Type DELETE in capital letters to confirm.');
  const password = String(formData.get('password') ?? '');
  if (!password) back('Enter your password to confirm.');

  const db = getDb();
  const allowed = await canDeleteAccount(db, s.userId);
  if (!allowed.ok) back(allowed.error);

  const { url, key } = supabaseConfig();
  const checker = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const check = await checker.auth.signInWithPassword({ email: s.email, password });
  if (check.error) back('The password is not correct.');

  // 1. Remove the login (this also removes the membership). If it fails, nothing else was touched.
  const admin = createSupabaseAdmin();
  const removed = await admin.auth.admin.deleteUser(s.userId);
  if (removed.error) back('Could not delete the account right now. Nothing was changed. Please try again.');

  // 2. Remove the workspace and all its data when nobody else is in it. A failure here leaves an empty workspace that the app owner can clear.
  await deleteWorkspaceIfEmpty(db, s.workspaceId).catch(() => false);

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut().catch(() => undefined);
  redirect('/login?deleted=1');
}
