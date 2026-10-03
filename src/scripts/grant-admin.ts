// Makes the user with OWNER_EMAIL a platform admin (may create invites and set workspace limits).
// The email is read from .env, never from the command line or chat. The user must already exist (npm run create-user).
// Usage: npm run grant-admin

import { createClient } from '@supabase/supabase-js';
import { requireValue } from '../lib/env';
import { loadEnv, openDb, run } from './common';

run(async () => {
  const env = loadEnv();
  const email = requireValue(env.OWNER_EMAIL, 'OWNER_EMAIL').toLowerCase();
  const admin = createClient(requireValue(env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'), requireValue(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (list.error) throw new Error(`Could not list users: ${list.error.message}`);
  const user = list.data.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) throw new Error('No user with OWNER_EMAIL exists yet. Run: npm run create-user');

  const db = openDb(env);
  try {
    await db.query('insert into platform_admins (user_id) values ($1) on conflict do nothing', [user.id]);
    console.log('Done. This user is now a platform admin.');
  } finally {
    await db.close();
  }
});
