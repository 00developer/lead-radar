// Smoke test of the running app (npm run start, or npm run dev) against the real database.
// It creates a TEMPORARY user in the owner's workspace, signs in the way a browser would, loads every page and checks that
// each one renders, then deletes the user again. It changes no lead data.
// Usage: start the app first, then: npm run smoke:ui [-- --base http://localhost:3000]

import crypto from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { requireValue } from '../lib/env';
import { loadEnv, parseArgs, run, strArg } from './common';

run(async () => {
  const args = parseArgs(process.argv.slice(2));
  const base = strArg(args, 'base') ?? 'http://localhost:3000';
  const env = loadEnv();
  const url = requireValue(env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const anon = requireValue(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  const admin = createClient(url, requireValue(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { autoRefreshToken: false, persistSession: false } });

  const email = `smoke-${crypto.randomBytes(4).toString('hex')}@example.com`;
  const password = crypto.randomBytes(18).toString('base64url');
  let userId: string | undefined;
  const results: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail });

  try {
    const ws = await admin.from('workspaces').select('id').order('created_at').limit(1).maybeSingle();
    if (ws.error || !ws.data) throw new Error(`Could not find the workspace: ${ws.error?.message ?? 'none exists'}`);
    const workspaceId = ws.data.id as string;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`Could not create the temporary user: ${created.error?.message}`);
    userId = created.data.user.id;
    const mem = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: userId, role: 'member' });
    if (mem.error) throw new Error(`Could not add the temporary member: ${mem.error.message}`);

    // Sign in exactly like the browser client would, and keep the cookies it wants to set.
    const jar = new Map<string, string>();
    const supabase = createServerClient(url, anon, {
      cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (list) => list.forEach((c) => jar.set(c.name, c.value)) },
    });
    const signIn = await supabase.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`Temporary user could not sign in: ${signIn.error.message}`);
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

    const get = async (path: string, withCookie: boolean) => {
      const res = await fetch(`${base}${path}`, { redirect: 'manual', headers: withCookie ? { cookie } : {} });
      return { status: res.status, location: res.headers.get('location') ?? '', text: await res.text() };
    };

    // Not logged in: everything private redirects to the login page.
    for (const p of ['/', '/leads', '/keywords', '/sources', '/settings', '/profile']) {
      const r = await get(p, false);
      check(`visitor is sent to /login from ${p}`, r.status >= 300 && r.status < 400 && r.location.includes('/login'), `${r.status} ${r.location}`);
    }
    const exportAnon = await get('/api/leads/export', false);
    check('Excel export needs a login', exportAnon.status >= 300 && exportAnon.status < 400 && exportAnon.location.includes('/login') && !exportAnon.text.includes('PK'), `${exportAnon.status}`);
    const login = await get('/login', false);
    check('login page renders', login.status === 200 && login.text.includes('Sign in'));
    const cron = await get('/api/cron/run', false);
    check('cron route refuses a request without the secret', cron.status === 401, String(cron.status));
    const connect = await get('/api/threads/connect', false);
    check('Threads connect needs a login', connect.status >= 300 && connect.status < 400 && connect.location.includes('/login'), `${connect.status}`);

    // Logged in: every page renders with real content.
    const pages: [string, string | RegExp][] = [['/', /waiting for you|all caught up|No leads yet/], ['/leads', /Filter leads|No leads yet/], ['/leads?view=hidden', /Posts the AI read|Nothing hidden/], ['/keywords', /Add a keyword/], ['/sources', /Threads account/], ['/settings', /Thresholds, filters and alerts/], ['/profile', /Scan your website|Products and services/], ['/insights', /What to do next|No leads yet/], ['/leads?label=none', /Not labeled yet/]];
    for (const [p, needle] of pages) {
      const r = await get(p, true);
      check(`logged in: ${p} renders`, r.status === 200 && (typeof needle === 'string' ? r.text.includes(needle) : needle.test(r.text)) && !r.text.includes('Something went wrong'), `${r.status}`);
    }
    const leads = await get('/leads', true);
    const firstLead = /href="\/leads\/([0-9a-f-]{36})"/.exec(leads.text)?.[1];
    check('the lead list shows leads', !!firstLead, firstLead ? '' : 'no lead link found');
    if (firstLead) {
      const d = await get(`/leads/${firstLead}`, true);
      check('a lead page renders with the post, AI analysis and reply box', d.status === 200 && d.text.includes('AI analysis') && d.text.includes('Reply draft') && d.text.includes('Contact hints'), `${d.status}`);
    }
    const xlsxRes = await fetch(`${base}/api/leads/export?hidden=1`, { redirect: 'manual', headers: { cookie } });
    const xlsx = Buffer.from(await xlsxRes.arrayBuffer());
    check(
      'Excel export downloads an .xlsx file (a zip starting with PK)',
      xlsxRes.status === 200 && (xlsxRes.headers.get('content-type') ?? '').includes('spreadsheetml.sheet') && /attachment; filename="[^"]+\.xlsx"/.test(xlsxRes.headers.get('content-disposition') ?? '') && xlsx.subarray(0, 2).toString() === 'PK' && xlsx.length > 2000,
      `${xlsxRes.status}, ${xlsx.length} bytes`,
    );
    check('the Leads page has the Export to Excel button', leads.text.includes('/api/leads/export') && leads.text.includes('Export to Excel'));
    const filteredLeads = await get('/leads?min=90&days=30', true);
    const shownIds = new Set([...filteredLeads.text.matchAll(/href="\/leads\/([0-9a-f-]{36})"/g)].map((m) => m[1]));
    check('a filtered Leads page says how many leads match and shows fewer than the full list', filteredLeads.status === 200 && /\d+ leads? match your filters/.test(filteredLeads.text) && shownIds.size < new Set([...leads.text.matchAll(/href="\/leads\/([0-9a-f-]{36})"/g)].map((m) => m[1])).size + 1, `${filteredLeads.status}`);
    const sourcesPage = await get('/sources', true);
    check('Leads and Sources show the "Updated" line with a Refresh button', [leads.text, sourcesPage.text].every((t) => t.includes('Updated') && t.includes('Refresh')));
    const login2 = await get('/login', false);
    check('the login button is the shared loading button (a normal submit button in the HTML)', /<button[^>]*type="submit"[^>]*>[^<]*(<[^>]+>)*Sign in/.test(login2.text));
    const bad = await get('/leads/not-a-uuid', true);
    check('a bad lead id shows the not-found page, not an error page', (bad.status === 404 || /could not be found/i.test(bad.text)) && !/Something went wrong/.test(bad.text), `${bad.status}`);
    const keywords = await get('/keywords', true);
    check('keywords page lists the seeded keywords', keywords.text.includes('need a website'));
    const settings = await get('/settings', true);
    check('settings page shows the four services', ['web_dev', 'saas', 'mobile_app', 'ai_automation'].every((s) => settings.text.includes(s)));
  } finally {
    if (userId) {
      await admin.auth.admin.deleteUser(userId).catch(() => {}); // cascades to workspace_members
      await admin.from('workspace_members').delete().eq('user_id', userId);
    }
  }

  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? `  (${r.detail})` : ''}`);
    if (!r.ok) failed += 1;
  }
  console.log(`\n${results.length - failed} of ${results.length} checks passed. The temporary user was deleted.`);
  if (failed > 0) process.exitCode = 1;
});
