// Creates the owner's login and adds it to the workspace. The email and password are read from .env
// (OWNER_EMAIL, OWNER_PASSWORD), never from the command line or chat. Remove OWNER_PASSWORD from .env afterwards.
// Usage: npm run create-user [-- --workspace <id>]

import { createClient } from '@supabase/supabase-js';
import { resolveWorkspaceId } from '../lib/pipeline/workspace';
import { requireValue } from '../lib/env';
import { loadEnv, openDb, parseArgs, run, strArg } from './common';

run(async () => {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const email = requireValue(env.OWNER_EMAIL, 'OWNER_EMAIL');
  const password = requireValue(env.OWNER_PASSWORD, 'OWNER_PASSWORD');
  if (password.length < 10) throw new Error('OWNER_PASSWORD must be at least 10 characters.');

  const admin = createClient(requireValue(env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'), requireValue(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let userId: string | undefined;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) {
    if (!/already|registered|exists/i.test(created.error.message)) throw new Error(`Could not create the user: ${created.error.message}`);
    const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    userId = list.data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    if (!userId) throw new Error('The user already exists but could not be found.');
    console.log('User already exists. Its password was NOT changed.');
  } else {
    userId = created.data.user.id;
    console.log('User created.');
  }

  const db = openDb(env);
  try {
    const workspaceId = await resolveWorkspaceId(db, strArg(args, 'workspace'));
    await db.query(
      "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner') on conflict (workspace_id, user_id) do nothing",
      [workspaceId, userId],
    );
    console.log(`Added to workspace ${workspaceId} as owner. You can now sign in.`);
  } finally {
    await db.close();
  }
});
