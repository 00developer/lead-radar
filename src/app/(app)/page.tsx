import Link from 'next/link';
import { requireSession } from '../../lib/auth';
import { getOverview } from '../../lib/dashboard/queries';
import { btn, btnPrimary, Card, EmptyState, StatCard } from '../../components/ui';
import { IconAlert, IconArrow, IconCoin, IconEyeOff, IconLeads, IconTarget } from '../../components/icons';

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<string, string> = { apify_threads: 'Threads via Apify', threads_api: 'Threads official API' };

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default async function OverviewPage() {
  const s = await requireSession();
  const o = await getOverview(s);
  const max = Math.max(1, ...o.perDay.map((d) => d.n));
  const rate = o.labeled > 0 ? `${Math.round((100 * o.genuine) / o.labeled)}%` : 'n/a';
  const usedPct = o.aiCeiling ? Math.min(100, (100 * o.aiUsed) / o.aiCeiling) : 0;

  return (
    <>
      {/* Hero */}
      <section className="card rise relative mb-6 overflow-hidden p-7 sm:p-9">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full opacity-30 blur-3xl" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }} />
        <p className="relative text-sm text-(--muted)">
          {greeting()}, {s.email?.split('@')[0] ?? 'there'}
        </p>
        <h1 className="relative mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
          {o.newLeads > 0 ? (
            <>
              <span className="grad-text">{o.newLeads} new {o.newLeads === 1 ? 'lead is' : 'leads are'}</span> waiting for you
            </>
          ) : (
            'You are all caught up'
          )}
        </h1>
        <p className="relative mt-2 max-w-xl text-(--muted)">
          {o.newLeads > 0 ? 'People asked for help. Open a lead, check the reason, copy the reply draft and get in touch.' : 'Run a new collection to look for fresh posts.'}
        </p>
        <div className="relative mt-6 flex flex-wrap gap-3">
          <Link className={btnPrimary} href="/leads?status=new">
            Review new leads <IconArrow width={16} height={16} />
          </Link>
          <Link className={btn} href="/sources">
            Run a collection
          </Link>
        </div>
      </section>

      {o.totalLeads === 0 ? (
        <EmptyState title="No leads yet">
          Go to <Link className="underline" href="/sources">Sources &amp; Runs</Link> and press Run now. New leads show up here.
        </EmptyState>
      ) : (
        <div className="grid gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="New leads" value={o.newLeads} hint={`${o.totalLeads} leads in total`} icon={<IconLeads />} />
            <StatCard label="Need review" value={o.needsReview} hint="The AI was unsure" icon={<IconAlert />} tone="warn" />
            <StatCard label="Genuine rate" value={rate} hint={`${o.genuine} of ${o.labeled} labeled · target 50%+`} icon={<IconTarget />} tone="good" />
            <StatCard label="Hidden by AI" value={o.hidden} hint="Check for missed buyers" icon={<IconEyeOff />} tone="neutral" />
          </div>

          <Card title="Leads per day" aside={<span className="text-xs text-(--muted)">last 14 days</span>}>
            <div className="flex h-40 items-end gap-2" role="img" aria-label={`Leads per day: ${o.perDay.map((d) => `${d.day} ${d.n}`).join(', ')}`}>
              {o.perDay.map((d) => (
                <div key={d.day} className="group flex flex-1 flex-col items-center justify-end gap-1.5" title={`${d.day}: ${d.n} lead${d.n === 1 ? '' : 's'}`}>
                  <span className="text-[11px] font-medium tabular-nums text-(--muted) opacity-0 transition group-hover:opacity-100">{d.n}</span>
                  <div
                    className={d.n ? 'grad-bg w-full rounded-t-lg transition group-hover:brightness-110' : 'w-full rounded-t-lg bg-(--neutral-bg)'}
                    style={{ height: `${Math.max(4, (d.n / max) * 118)}px` }}
                  />
                  <span className="text-[11px] tabular-nums text-(--muted)">{d.day.slice(8)}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card title="Leads and spend per source" className="lg:col-span-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-(--muted)">
                    <th className="pb-2 font-medium">Source</th>
                    <th className="pb-2 text-right font-medium">Leads</th>
                    <th className="pb-2 text-right font-medium">Spend</th>
                    <th className="pb-2 text-right font-medium">Per lead</th>
                  </tr>
                </thead>
                <tbody>
                  {o.perSource.map((r) => (
                    <tr key={r.source} className="border-t border-(--border)">
                      <td className="py-3 font-medium">{SOURCE_LABEL[r.source] ?? r.source}</td>
                      <td className="py-3 text-right tabular-nums">{r.leads}</td>
                      <td className="py-3 text-right tabular-nums">${r.spendUsd.toFixed(3)}</td>
                      <td className="py-3 text-right tabular-nums text-(--muted)">{r.leads ? `$${(r.spendUsd / r.leads).toFixed(3)}` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="AI usage this month" className="lg:col-span-2">
              <div className="flex items-center gap-4">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-(--accent-soft) text-(--accent)">
                  <IconCoin />
                </span>
                <p className="text-3xl font-semibold tabular-nums">
                  {o.aiUsed} <span className="text-base font-normal text-(--muted)">of {o.aiCeiling} calls</span>
                </p>
              </div>
              <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-(--neutral-bg)" role="progressbar" aria-valuenow={o.aiUsed} aria-valuemin={0} aria-valuemax={o.aiCeiling} aria-label="AI calls used this month">
                <div className="grad-bg h-full rounded-full" style={{ width: `${usedPct}%` }} />
              </div>
              <p className="mt-2 text-xs text-(--muted)">{Math.round(usedPct)}% of the monthly safety limit</p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
