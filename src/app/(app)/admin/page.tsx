import { requirePlatformAdmin } from '../../../lib/app/admin';
import { appUrl, getDb } from '../../../lib/app/server';
import { inviteStatus, listInvites, MAX_INVITE_DAYS } from '../../../lib/phase4/invites';
import { listWorkspaceOverview } from '../../../lib/phase4/workspaces';
import { Badge, btn, btnDanger, btnPrimary, Card, EmptyState, ErrorBanner, input, Notice, PageHeader } from '../../../components/ui';
import { LocalTime } from '../../../components/local-time';
import { createInviteAction, revokeInviteAction, savePlanAction } from '../../actions/admin';

export const dynamic = 'force-dynamic';

const TONE = { open: 'good', used: 'neutral', expired: 'warn', revoked: 'bad' } as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string; notice?: string }> }) {
  await requirePlatformAdmin();
  const p = await searchParams;
  const db = getDb();
  const [invites, workspaces] = await Promise.all([listInvites(db), listWorkspaceOverview(db)]);
  const link = p.token ? `${appUrl()}/signup?token=${encodeURIComponent(p.token)}` : null;

  return (
    <>
      <PageHeader title="Admin" subtitle="Invite customers and control what each workspace may spend. Only you can see this page." />
      {p.error && <ErrorBanner>{p.error}</ErrorBanner>}
      {p.notice && <Notice>{p.notice}</Notice>}

      {link && (
        <Card title="Invite link ready">
          <p className="mb-2 text-sm text-(--muted)">Copy it now and send it to the customer (WhatsApp or email). For safety it is not shown again after you leave this page. It works once.</p>
          <input className={`${input} w-full font-mono text-xs`} readOnly value={link} aria-label="Invite link" />
        </Card>
      )}

      <div className="mb-6 grid gap-4">
        <Card title="Create an invite">
          <form action={createInviteAction} className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              Customer email (optional)
              <input className={`${input} w-64`} type="email" name="email" placeholder="locks the invite to this email" />
            </label>
            <label className="grid gap-1 text-sm">
              Note (only you see it)
              <input className={`${input} w-56`} type="text" name="note" maxLength={200} placeholder="who is this for" />
            </label>
            <label className="grid gap-1 text-sm">
              Valid for (days)
              <input className={`${input} w-24`} type="number" name="days" min={1} max={MAX_INVITE_DAYS} defaultValue={7} />
            </label>
            <button className={btnPrimary} type="submit">Create link</button>
          </form>
        </Card>

        <Card title="Invites">
          {invites.length === 0 ? (
            <EmptyState title="No invites yet">Create one above.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-160 text-sm">
                <thead>
                  <tr className="text-left text-(--muted)">
                    <th className="pb-1 font-medium">Created</th>
                    <th className="pb-1 font-medium">For</th>
                    <th className="pb-1 font-medium">Status</th>
                    <th className="pb-1 font-medium">Expires</th>
                    <th className="pb-1" />
                  </tr>
                </thead>
                <tbody>
                  {invites.map((i) => {
                    const st = inviteStatus(i);
                    return (
                      <tr key={i.id} className="border-t border-(--border)">
                        <td className="py-1.5"><LocalTime value={i.created_at} /></td>
                        <td className="py-1.5">{[i.email, i.note].filter(Boolean).join(' · ') || 'anyone with the link'}</td>
                        <td className="py-1.5"><Badge tone={TONE[st]}>{st}</Badge></td>
                        <td className="py-1.5"><LocalTime value={i.expires_at} /></td>
                        <td className="py-1.5 text-right">
                          {st === 'open' && (
                            <form action={revokeInviteAction}>
                              <input type="hidden" name="id" value={i.id} />
                              <button className={btnDanger} type="submit">Revoke</button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Workspaces and limits">
          <p className="mb-3 text-sm text-(--muted)">A new customer workspace starts with collection switched off. Turn a source on only when you are ready to pay for it. These limits are the real ceiling: the customer cannot raise them.</p>
          <div className="grid gap-4">
            {workspaces.map((w) => (
              <form key={w.id} action={savePlanAction} className="rounded-xl border border-(--border) p-4">
                <input type="hidden" name="id" value={w.id} />
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{w.name}</p>
                  <p className="text-xs text-(--muted)">
                    {w.members} member(s) · {w.leads} leads · this month: {w.runs_this_month} run(s), ${Number(w.cost_this_month).toFixed(2)} collected, {w.ai_calls_this_month} AI calls · {w.sources_enabled} source(s) on
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="allow_apify" defaultChecked={w.plan?.allowApify ?? false} /> Apify allowed
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="allow_official_api" defaultChecked={w.plan?.allowOfficialApi ?? false} /> Official API allowed
                  </label>
                  <label className="grid gap-1 text-sm">
                    Max posts per run
                    <input className={`${input} w-28`} type="number" name="max_results_cap" min={1} max={1000} defaultValue={w.plan?.maxResultsCap ?? 100} />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Max spend per run (USD)
                    <input className={`${input} w-28`} type="number" step="0.01" name="max_spend_cap_usd" min={0} max={50} defaultValue={w.plan?.maxSpendCapUsd ?? 0.5} />
                  </label>
                  <label className="grid gap-1 text-sm">
                    AI calls per month
                    <input className={`${input} w-28`} type="number" name="ai_monthly_cap" min={0} defaultValue={w.plan?.aiMonthlyCap ?? 200} />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Note
                    <input className={`${input} w-44`} type="text" name="note" maxLength={200} defaultValue={w.plan?.note ?? ''} />
                  </label>
                  <button className={btn} type="submit">Save plan</button>
                </div>
                {!w.plan && <p className="mt-2 text-xs text-(--bad)">This workspace has no plan, so nothing can run until you save one.</p>}
              </form>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
