// Verifies Row Level Security on the REAL Supabase project with two temporary users and two temporary workspaces.
// Everything it creates is deleted at the end. It never touches the owner's workspace.
// Usage: npm run verify:rls
//
// Checks: a user sees only their own workspace's leads, cannot read or change another workspace's rows, cannot write into it,
// cannot read the encrypted Threads token column, and cannot call the AI usage function.

import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireValue } from '../lib/env';
import { seedOwnerWorkspace } from '../lib/seed';
import { loadEnv, openDb, run } from './common';

type Check = { name: string; ok: boolean; detail?: string };

run(async () => {
  const env = loadEnv();
  const url = requireValue(env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireValue(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  const admin = createClient(url, requireValue(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { autoRefreshToken: false, persistSession: false } });
  const db = openDb(env);
  const tag = crypto.randomBytes(4).toString('hex');
  const password = crypto.randomBytes(18).toString('base64url');
  const emailA = `rls-a-${tag}@example.com`;
  const emailB = `rls-b-${tag}@example.com`;
  const created: { userIds: string[]; workspaceIds: string[] } = { userIds: [], workspaceIds: [] };
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  try {
    const wsA = await seedOwnerWorkspace(db, `rls-test-A-${tag}`);
    const wsB = await seedOwnerWorkspace(db, `rls-test-B-${tag}`);
    created.workspaceIds.push(wsA, wsB);

    const mk = async (email: string) => {
      const r = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (r.error || !r.data.user) throw new Error(`Could not create a test user: ${r.error?.message}`);
      created.userIds.push(r.data.user.id);
      return r.data.user.id;
    };
    const [userA, userB] = [await mk(emailA), await mk(emailB)];
    await db.query("insert into workspace_members (workspace_id, user_id, role) values ($1,$2,'owner'), ($3,$4,'owner')", [wsA, userA, wsB, userB]);

    // One lead and one stored connection per workspace.
    const leadIds: Record<string, string> = {};
    for (const ws of [wsA, wsB]) {
      const p = await db.query<{ id: string }>(
        "insert into posts (workspace_id, source, external_id, url, text, author_handle, prefilter_status) values ($1,'apify_threads',$2,'https://example.com/p',$3,'someone','passed') returning id",
        [ws, `rls-${tag}`, `secret post of ${ws}`],
      );
      const c = await db.query<{ id: string }>(
        "insert into classifications (workspace_id, post_id, prompt_version, model, author_type, intent_score, language) values ($1,$2,'v2','test','buyer',90,'en') returning id",
        [ws, p.rows[0].id],
      );
      const l = await db.query<{ id: string }>('insert into leads (workspace_id, post_id, classification_id) values ($1,$2,$3) returning id', [ws, p.rows[0].id, c.rows[0].id]);
      leadIds[ws] = l.rows[0].id;
      await db.query("insert into threads_connections (workspace_id, threads_user_id, username, access_token_encrypted) values ($1,'1','u','ENCRYPTED-TEST-VALUE')", [ws]);
    }

    const login = async (email: string): Promise<SupabaseClient> => {
      const c = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const r = await c.auth.signInWithPassword({ email, password });
      if (r.error) throw new Error(`Test user could not sign in: ${r.error.message}`);
      return c;
    };
    const a = await login(emailA);
    const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // 1. Reads
    const own = await a.from('lead_inbox').select('id,workspace_id');
    check('user A sees exactly one lead (their own)', !own.error && own.data?.length === 1 && own.data[0].workspace_id === wsA, own.error?.message);
    const other = await a.from('lead_inbox').select('id').eq('workspace_id', wsB);
    check('user A cannot read workspace B leads by asking for them', !other.error && other.data?.length === 0);
    const otherPosts = await a.from('posts').select('id').eq('workspace_id', wsB);
    check('user A cannot read workspace B posts', !otherPosts.error && otherPosts.data?.length === 0);
    const otherView = await a.from('hidden_posts').select('post_id').eq('workspace_id', wsB);
    check('user A cannot read workspace B through the hidden_posts view', !otherView.error && otherView.data?.length === 0);
    const otherWs = await a.from('workspaces').select('id');
    check('user A sees only their own workspace row', !otherWs.error && otherWs.data?.length === 1 && otherWs.data[0].id === wsA);

    // 2. Writes
    const upd = await a.from('leads').update({ notes: 'hacked' }).eq('id', leadIds[wsB]).select('id');
    check('user A cannot update a workspace B lead', !upd.error && upd.data?.length === 0);
    const ins = await a.from('keywords').insert({ workspace_id: wsB, term: 'injected', language: 'en' });
    check('user A cannot insert a keyword into workspace B', !!ins.error);
    const mine = await a.from('leads').update({ status: 'contacted' }).eq('id', leadIds[wsA]).select('id,status');
    check('user A can update their own lead', !mine.error && mine.data?.[0]?.status === 'contacted', mine.error?.message);
    const ev = await db.query<{ n: string }>("select count(*) as n from lead_events where lead_id = $1 and event = 'status_changed' and actor = $2", [leadIds[wsA], userA]);
    check('the status change was logged in lead_events with the user as actor', Number(ev.rows[0].n) === 1);

    // 3. Secrets and functions
    const tok = await a.from('threads_connections').select('access_token_encrypted');
    check('the encrypted Threads token column cannot be read by a user', !!tok.error, tok.error?.message);
    const okCols = await a.from('threads_connections').select('id,username,status');
    check('other connection columns are readable for the own workspace only', !okCols.error && okCols.data?.length === 1);
    const fn = await a.rpc('try_record_ai_usage', { p_workspace_id: wsA, p_kind: 'classify', p_ceiling: 5 });
    check('a user cannot call try_record_ai_usage', !!fn.error, fn.error?.message);

    // 4. Not logged in
    const anonLeads = await anon.from('lead_inbox').select('id');
    check('a visitor who is not logged in sees no leads', !anonLeads.error && anonLeads.data?.length === 0);
  } finally {
    // Clean up everything created here.
    for (const id of created.workspaceIds) await db.query('delete from workspaces where id = $1', [id]).catch(() => {});
    for (const id of created.userIds) await admin.auth.admin.deleteUser(id).catch(() => {});
    await db.close();
  }

  let failed = 0;
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${!c.ok && c.detail ? `  (${c.detail})` : ''}`);
    if (!c.ok) failed += 1;
  }
  console.log(`\n${checks.length - failed} of ${checks.length} checks passed. Temporary users and workspaces were deleted.`);
  if (failed > 0) process.exitCode = 1;
});
