import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryDb } from '../src/lib/db/memory';
import { migrate } from '../src/lib/db/migrate';
import type { Db } from '../src/lib/db/types';
import type { Collector, CollectorRunInput } from '../src/lib/collectors/types';
import { createFakeLlm } from '../src/lib/classifier/fake-llm';
import { runWorkspacePipeline, type OrchestrateDeps } from '../src/lib/pipeline/orchestrate';
import { loadWorkspace } from '../src/lib/pipeline/workspace';
import { claimInvite, createInvite, findOpenInvite, hashToken, inviteStatus, listInvites, releaseInvite, revokeInvite } from '../src/lib/phase4/invites';
import {
  createCustomerWorkspace, effectiveAiCeiling, effectiveLimits, getPlan, isPlatformAdmin, listWorkspaceOverview, NEW_WORKSPACE_PLAN, savePlan, workspaceAiCeiling,
} from '../src/lib/phase4/workspaces';
import { getOnboardingSteps } from '../src/lib/phase4/onboarding';
import { seedOwnerWorkspace } from '../src/lib/seed';

let db: Db;
beforeAll(async () => {
  db = await createMemoryDb();
  await migrate(db);
});
afterAll(async () => {
  await db.close();
});

const newUser = async (email: string) => (await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email])).rows[0].id;

describe('invites', () => {
  it('stores only a hash, never the token', async () => {
    const inv = await createInvite(db, { createdBy: null, note: 'for Asha' });
    const row = (await db.query<{ token_hash: string }>('select token_hash from invites where id = $1', [inv.id])).rows[0];
    expect(row.token_hash).toBe(hashToken(inv.token));
    expect(row.token_hash).not.toContain(inv.token);
    expect(inv.token.length).toBeGreaterThanOrEqual(40);
  });
  it('can be claimed exactly once, even when two people click at the same time', async () => {
    const inv = await createInvite(db, { createdBy: null });
    expect(await findOpenInvite(db, inv.token)).not.toBeNull();
    const [a, b] = await Promise.all([claimInvite(db, inv.token), claimInvite(db, inv.token)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await findOpenInvite(db, inv.token)).toBeNull();
    expect(await claimInvite(db, inv.token)).toBeNull();
  });
  it('can be given back after a failed signup, and then used again', async () => {
    const inv = await createInvite(db, { createdBy: null });
    const claimed = await claimInvite(db, inv.token);
    expect(claimed).not.toBeNull();
    await releaseInvite(db, claimed!.id);
    expect(await claimInvite(db, inv.token)).not.toBeNull();
  });
  it('expires', async () => {
    const past = new Date(Date.now() - 10 * 86_400_000);
    const inv = await createInvite(db, { createdBy: null, days: 1, now: past });
    expect(await findOpenInvite(db, inv.token)).toBeNull();
    expect(await claimInvite(db, inv.token)).toBeNull();
  });
  it('can be revoked, but only while it is unused', async () => {
    const a = await createInvite(db, { createdBy: null });
    expect(await revokeInvite(db, a.id)).toBe(true);
    expect(await claimInvite(db, a.token)).toBeNull();
    const b = await createInvite(db, { createdBy: null });
    await claimInvite(db, b.token);
    expect(await revokeInvite(db, b.id)).toBe(false);
  });
  it('limits the lifetime to 30 days and lower-cases the locked email', async () => {
    const inv = await createInvite(db, { createdBy: null, email: ' Asha@Example.COM ', days: 999 });
    const row = (await db.query<{ email: string; expires_at: Date }>('select email, expires_at from invites where id = $1', [inv.id])).rows[0];
    expect(row.email).toBe('asha@example.com');
    expect(new Date(row.expires_at).getTime() - Date.now()).toBeLessThan(31 * 86_400_000);
  });
  it('rejects tokens of the wrong shape without touching the database', async () => {
    expect(await findOpenInvite(db, '')).toBeNull();
    expect(await findOpenInvite(db, 'short')).toBeNull();
    expect(await claimInvite(db, 'x'.repeat(500))).toBeNull();
  });
  it('reports a status for the Admin list', async () => {
    const rows = await listInvites(db);
    expect(rows.length).toBeGreaterThan(3);
    const statuses = new Set(rows.map((r) => inviteStatus(r)));
    expect(statuses.has('open') && statuses.has('used') && statuses.has('revoked')).toBe(true);
  });
});

describe('customer workspace', () => {
  it('starts empty, restricted and switched off', async () => {
    const user = await newUser('asha@example.com');
    const id = await createCustomerWorkspace(db, { name: '  Asha Water Purifiers ', userId: user });
    expect((await db.query<{ name: string }>('select name from workspaces where id = $1', [id])).rows[0].name).toBe('Asha Water Purifiers');
    expect((await db.query<{ role: string }>('select role from workspace_members where workspace_id = $1 and user_id = $2', [id, user])).rows[0].role).toBe('owner');
    const sources = (await db.query<{ source: string; enabled: boolean }>('select source, enabled from workspace_sources where workspace_id = $1', [id])).rows;
    expect(sources).toHaveLength(2);
    expect(sources.every((s) => !s.enabled)).toBe(true);
    expect(await getPlan(db, id)).toMatchObject({ allowApify: false, allowOfficialApi: false, maxResultsCap: 100, maxSpendCapUsd: 0.5, aiMonthlyCap: 200 });
    const ws = await loadWorkspace(db, id);
    expect(ws.services.map((s) => s.slug)).toEqual(['general']);
    expect(ws.keywords).toEqual([]);
    expect(ws.negativeTerms.length).toBeGreaterThan(3);
    expect(ws.settings.aiMonthlyCeiling).toBe(200);
    expect(ws.profile).toBeNull();
  });
  it('rejects a one-letter business name and leaves nothing behind', async () => {
    const user = await newUser('b@example.com');
    const before = (await db.query<{ n: string }>('select count(*) n from workspaces')).rows[0].n;
    await expect(createCustomerWorkspace(db, { name: 'A', userId: user })).rejects.toThrow();
    expect((await db.query<{ n: string }>('select count(*) n from workspaces')).rows[0].n).toBe(before);
  });
  it('rolls everything back when a step fails (unknown user)', async () => {
    const before = (await db.query<{ n: string }>('select count(*) n from workspaces')).rows[0].n;
    await expect(createCustomerWorkspace(db, { name: 'Ghost Co', userId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow();
    expect((await db.query<{ n: string }>('select count(*) n from workspaces')).rows[0].n).toBe(before);
  });
  it('keeps data of two workspaces apart', async () => {
    const u1 = await newUser('one@example.com');
    const u2 = await newUser('two@example.com');
    const w1 = await createCustomerWorkspace(db, { name: 'One Co', userId: u1 });
    const w2 = await createCustomerWorkspace(db, { name: 'Two Co', userId: u2 });
    await db.query("insert into keywords (workspace_id, term, language) values ($1,'need a plumber','en')", [w1]);
    expect((await loadWorkspace(db, w1)).keywords.map((k) => k.term)).toEqual(['need a plumber']);
    expect((await loadWorkspace(db, w2)).keywords).toEqual([]);
  });
});

describe('the plan is the real limit', () => {
  const collectorSeeing = (seen: { input?: CollectorRunInput }): Collector => ({
    id: 'apify_threads',
    async run(i) {
      seen.input = i;
      return { posts: [], costUsd: 0, queriesUsed: 0, status: 'ok' };
    },
  });
  const deps = (collector: Collector): OrchestrateDeps => ({
    collectorFor: async () => collector, llm: createFakeLlm(), channel: null, appUrl: 'http://x', globalMonthlyCeiling: 2000, maxCalls: 100,
  });
  const customer = async (email: string) => createCustomerWorkspace(db, { name: `Co ${email}`, userId: await newUser(email) });

  it('refuses a run while the owner has not allowed the source, even if the workspace switched it on itself', async () => {
    const id = await customer('plan1@example.com');
    await db.query("update workspace_sources set enabled = true where workspace_id = $1 and source = 'apify_threads'", [id]);
    const r = await runWorkspacePipeline(db, id, 'apify_threads', deps(collectorSeeing({})));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('not enabled for your workspace') });
  });
  it('clamps a run to the plan even if the workspace saved higher limits itself', async () => {
    const id = await customer('plan2@example.com');
    await savePlan(db, id, { ...NEW_WORKSPACE_PLAN, allowApify: true, maxResultsCap: 20, maxSpendCapUsd: 0.1 });
    await db.query("update workspace_sources set enabled = true, max_results = 1000, max_spend_usd = 50 where workspace_id = $1 and source = 'apify_threads'", [id]);
    const seen: { input?: CollectorRunInput } = {};
    const r = await runWorkspacePipeline(db, id, 'apify_threads', deps(collectorSeeing(seen)));
    expect(r.ok).toBe(true);
    expect(seen.input).toMatchObject({ maxResults: 20, maxSpendUsd: 0.1 });
  });
  it('fails closed for a workspace that has no plan at all', async () => {
    const user = await newUser('plan3@example.com');
    const id = (await db.query<{ id: string }>("insert into workspaces (name) values ('No plan') returning id")).rows[0].id;
    await db.query('insert into workspace_settings (workspace_id) values ($1)', [id]);
    await db.query("insert into workspace_sources (workspace_id, source, enabled) values ($1,'apify_threads',true)", [id]);
    await db.query("insert into workspace_members (workspace_id, user_id, role) values ($1,$2,'owner')", [id, user]);
    expect(await runWorkspacePipeline(db, id, 'apify_threads', deps(collectorSeeing({})))).toMatchObject({ ok: false });
    expect((await loadWorkspace(db, id)).settings.aiMonthlyCeiling).toBe(0);
    expect(await workspaceAiCeiling(db, id, 2000)).toBe(0);
  });
  it('caps the AI ceiling by the plan and by the global ceiling', async () => {
    const id = await customer('plan4@example.com');
    await db.query('update workspace_settings set ai_monthly_ceiling = 100000 where workspace_id = $1', [id]);
    expect((await loadWorkspace(db, id)).settings.aiMonthlyCeiling).toBe(200);
    expect(await workspaceAiCeiling(db, id, 150)).toBe(150);
    expect(effectiveAiCeiling(50, { ...NEW_WORKSPACE_PLAN, aiMonthlyCap: 200 })).toBe(50);
    expect(effectiveLimits(NEW_WORKSPACE_PLAN, { maxResults: 5, maxSpendUsd: 0.01 })).toEqual({ maxResults: 5, maxSpendUsd: 0.01 });
  });
  it('gives the owner workspace full access when it is seeded', async () => {
    const id = await seedOwnerWorkspace(db, 'Owner Co');
    expect(await getPlan(db, id)).toMatchObject({ allowApify: true, allowOfficialApi: true, maxResultsCap: 1000, maxSpendCapUsd: 50 });
  });
  it('shows every workspace on the Admin page with its plan', async () => {
    const all = await listWorkspaceOverview(db);
    expect(all.length).toBeGreaterThan(3);
    expect(all.find((w) => w.name === 'Owner Co')?.plan?.allowApify).toBe(true);
    expect(all.find((w) => w.name === 'No plan')?.plan).toBeNull();
  });
  it('knows who is a platform admin', async () => {
    const admin = await newUser('admin@example.com');
    const other = await newUser('other@example.com');
    await db.query('insert into platform_admins (user_id) values ($1)', [admin]);
    expect(await isPlatformAdmin(db, admin)).toBe(true);
    expect(await isPlatformAdmin(db, other)).toBe(false);
  });
});

describe('onboarding checklist', () => {
  it('starts with nothing done and follows the real data', async () => {
    const id = await createCustomerWorkspace(db, { name: 'Steps Co', userId: await newUser('steps@example.com') });
    let steps = await getOnboardingSteps(db, id);
    expect(steps.map((s) => s.done)).toEqual([false, false, false, false, false]);

    await db.query("insert into business_profiles (workspace_id, website_url, status) values ($1,'https://example.com','draft')", [id]);
    await db.query("insert into business_offerings (workspace_id, kind, name, origin, confirmed) values ($1,'service','Water purifier repair','manual',false)", [id]);
    steps = await getOnboardingSteps(db, id);
    expect(steps.find((s) => s.key === 'scan')?.done).toBe(true);
    expect(steps.find((s) => s.key === 'confirm')?.done).toBe(false);

    await db.query("update business_offerings set confirmed = true where workspace_id = $1", [id]);
    await db.query("update business_profiles set status = 'confirmed' where workspace_id = $1", [id]);
    await db.query("insert into keywords (workspace_id, term, language) values ($1,'need ro service','en')", [id]);
    steps = await getOnboardingSteps(db, id);
    expect(steps.find((s) => s.key === 'confirm')?.done).toBe(true);
    expect(steps.find((s) => s.key === 'keywords')?.done).toBe(true);
    expect(steps.find((s) => s.key === 'collection')?.done).toBe(false);

    await savePlan(db, id, { ...NEW_WORKSPACE_PLAN, allowApify: true });
    await db.query("update workspace_sources set enabled = true where workspace_id = $1 and source = 'apify_threads'", [id]);
    expect((await getOnboardingSteps(db, id)).find((s) => s.key === 'collection')?.done).toBe(true);
  });
});

import { buildInviteEmail } from '../src/lib/phase4/invite-email';
import { createResendChannel } from '../src/lib/alerts/email';

describe('invite email', () => {
  const link = 'https://app.example.com/signup?token=abc_DEF-123';
  it('contains the link once in text and html, escaped, with a stable idempotency key', () => {
    const m = buildInviteEmail({ inviteId: 'id-1', to: 'a@example.com', link: `${link}&x="<b>`, expiresAt: new Date('2026-10-10T10:00:00Z') });
    expect(m.key).toBe('invite-id-1');
    expect(m.to).toBe('a@example.com');
    expect(m.text).toContain(link);
    expect(m.html).toContain('&quot;&lt;b&gt;');
    expect(m.html).not.toContain('<b>');
    expect(m.text).toContain('10 Oct 2026');
  });
  it('is sent through the Resend channel to the invited address only', async () => {
    const calls: { body: string }[] = [];
    const channel = createResendChannel({
      apiKey: 'k', from: 'Lead Radar <hi@example.com>',
      fetchFn: async (_url, init) => { calls.push({ body: init.body }); return { ok: true, status: 200, json: async () => ({ id: 'x' }) }; },
    });
    const r = await channel.send(buildInviteEmail({ inviteId: 'id-2', to: 'b@example.com', link, expiresAt: new Date() }));
    expect(r.ok).toBe(true);
    expect(JSON.parse(calls[0].body)).toMatchObject({ to: ['b@example.com'], subject: 'You are invited to Lead Radar' });
  });
});

import { canDeleteAccount, deleteWorkspaceIfEmpty, memberCount, typedWordMatches } from '../src/lib/phase4/account';

describe('account deletion', () => {
  it('needs the exact word DELETE', () => {
    expect(typedWordMatches('DELETE')).toBe(true);
    expect(typedWordMatches(' DELETE ')).toBe(true);
    expect(typedWordMatches('delete')).toBe(false);
    expect(typedWordMatches('')).toBe(false);
    expect(typedWordMatches(null)).toBe(false);
  });
  it('does not allow a platform admin to delete their account from the app', async () => {
    const admin = await newUser('del-admin@example.com');
    await db.query('insert into platform_admins (user_id) values ($1)', [admin]);
    expect((await canDeleteAccount(db, admin)).ok).toBe(false);
    expect((await canDeleteAccount(db, await newUser('del-user@example.com'))).ok).toBe(true);
  });
  it('removes the whole workspace with all its data once the last member is gone, and leaves other workspaces alone', async () => {
    const gone = await newUser('gone@example.com');
    const stays = await newUser('stays@example.com');
    const w1 = await createCustomerWorkspace(db, { name: 'Leaving Co', userId: gone });
    const w2 = await createCustomerWorkspace(db, { name: 'Staying Co', userId: stays });
    for (const w of [w1, w2]) {
      const p = (await db.query<{ id: string }>("insert into posts (workspace_id, source, external_id, url, text, author_handle) values ($1,'apify_threads','x','https://x/y','need a site','h') returning id", [w])).rows[0].id;
      await db.query("insert into keywords (workspace_id, term, language) values ($1,'need a site','en')", [w]);
      await db.query("insert into threads_connections (workspace_id, threads_user_id, username, access_token_encrypted) values ($1,'1','u','ENC')", [w]);
      await db.query("insert into ai_usage (workspace_id) values ($1)", [w]);
      expect(p).toBeTruthy();
    }
    expect(await memberCount(db, w1)).toBe(1);
    // The app deletes the login first (this removes the membership), then the workspace.
    expect(await deleteWorkspaceIfEmpty(db, w1)).toBe(false);
    await db.query('delete from auth.users where id = $1', [gone]);
    expect(await memberCount(db, w1)).toBe(0);
    expect(await deleteWorkspaceIfEmpty(db, w1)).toBe(true);

    for (const t of ['posts', 'keywords', 'threads_connections', 'ai_usage', 'workspace_sources', 'workspace_plans', 'workspace_services', 'workspace_settings']) {
      expect(Number((await db.query<{ n: string }>(`select count(*) n from ${t} where workspace_id = $1`, [w1])).rows[0].n), t).toBe(0);
    }
    expect(Number((await db.query<{ n: string }>('select count(*) n from posts where workspace_id = $1', [w2])).rows[0].n)).toBe(1);
    expect(await memberCount(db, w2)).toBe(1);
  });
  it('keeps the workspace while another member is still in it', async () => {
    const a = await newUser('multi-a@example.com');
    const b = await newUser('multi-b@example.com');
    const w = await createCustomerWorkspace(db, { name: 'Shared Co', userId: a });
    await db.query("insert into workspace_members (workspace_id, user_id, role) values ($1,$2,'member')", [w, b]);
    await db.query('delete from auth.users where id = $1', [a]);
    expect(await deleteWorkspaceIfEmpty(db, w)).toBe(false);
    expect(await memberCount(db, w)).toBe(1);
  });
});
