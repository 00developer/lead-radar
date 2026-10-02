import Link from 'next/link';
import { requireSession } from '../../../lib/auth';
import { computeInsights, MIN_LABELS_FOR_TRUST, pct, type Group, type InsightRow } from '../../../lib/insights';
import { Badge, btnPrimary, Card, EmptyState, PageHeader, StatCard } from '../../../components/ui';
import { IconCheck, IconSparkle, IconTarget } from '../../../components/icons';

export const dynamic = 'force-dynamic';

function GroupTable({ title, groups, empty }: { title: string; groups: Group[]; empty: string }) {
  return (
    <Card title={title}>
      {groups.length === 0 ? (
        <p className="text-sm text-(--muted)">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-96 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-(--muted)">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 text-right font-medium">Leads</th>
                <th className="pb-2 text-right font-medium">Labeled</th>
                <th className="pb-2 text-right font-medium">Genuine</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="border-t border-(--border)">
                  <td className="py-2.5 pr-3 font-medium">{g.key}</td>
                  <td className="py-2.5 text-right tabular-nums">{g.total}</td>
                  <td className="py-2.5 text-right tabular-nums text-(--muted)">{g.labeled}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    {g.rate === null ? (
                      <span className="text-(--muted)">n/a</span>
                    ) : (
                      <Badge tone={g.labeled >= 5 ? (g.rate >= 0.5 ? 'good' : g.rate < 0.3 ? 'bad' : 'warn') : 'neutral'}>
                        {pct(g.rate)} ({g.genuine}/{g.labeled})
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default async function InsightsPage() {
  const s = await requireSession();
  const { data, error } = await s.supabase
    .from('lead_inbox')
    .select('intent_score,review_label,matched_keyword,service,language,source')
    .eq('workspace_id', s.workspaceId)
    .limit(5000);
  if (error) throw new Error(`Could not load the insights: ${error.message}`);
  const rows = (data ?? []) as InsightRow[];
  const ins = computeInsights(rows);

  return (
    <>
      <PageHeader title="Insights" subtitle="Your labels turned into numbers: which keywords work, how trustworthy the intent score is, and what a different threshold would do.">
        <Link className={btnPrimary} href="/leads?label=none">
          Label leads
        </Link>
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState title="No leads yet">Run a collection first. When leads exist, label them here to see what works.</EmptyState>
      ) : (
        <div className="grid gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Genuine rate" value={pct(ins.rate)} hint={`target ${pct(ins.targetRate)} or more`} icon={<IconTarget />} tone={ins.rate !== null && ins.rate >= ins.targetRate ? 'good' : 'warn'} />
            <StatCard label="Labeled leads" value={`${ins.labeled} of ${ins.total}`} hint={ins.fewLabels ? `about ${MIN_LABELS_FOR_TRUST} labels give the first trustworthy numbers` : 'enough labels for a first look'} icon={<IconCheck />} />
            <StatCard label="Genuine leads" value={ins.genuine} hint="labeled as a real lead" icon={<IconSparkle />} tone="good" />
          </div>

          <Card title="What to do next">
            <ul className="grid gap-2 text-sm">
              {ins.advice.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-(--accent)" aria-hidden="true" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-(--muted)">This page only gives advice. Nothing changes until you change it on the Keywords or Settings page.</p>
          </Card>

          <Card title="What if the lead threshold were different?" aside={<span className="text-xs text-(--muted)">uses only labeled leads</span>}>
            {ins.labeled === 0 ? (
              <p className="text-sm text-(--muted)">Label some leads first.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-120 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-(--muted)">
                      <th className="pb-2 font-medium">Threshold</th>
                      <th className="pb-2 text-right font-medium">Leads kept</th>
                      <th className="pb-2 text-right font-medium">Genuine share</th>
                      <th className="pb-2 text-right font-medium">Genuine leads lost</th>
                      <th className="pb-2 text-right font-medium">Genuine kept</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ins.thresholds.map((t) => (
                      <tr key={t.threshold} className={`border-t border-(--border) ${t.threshold === 60 ? 'bg-(--accent-soft)' : ''}`}>
                        <td className="py-2.5 font-medium">{t.threshold}{t.threshold === 60 ? ' (default)' : ''}</td>
                        <td className="py-2.5 text-right tabular-nums">{t.keptLabeled}</td>
                        <td className="py-2.5 text-right tabular-nums">{pct(t.precision)}</td>
                        <td className="py-2.5 text-right tabular-nums">{t.genuineLost}</td>
                        <td className="py-2.5 text-right tabular-nums text-(--muted)">{pct(t.recall)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <GroupTable title="By keyword" groups={ins.byKeyword} empty="No keyword data yet." />
            <GroupTable title="By intent score" groups={ins.byIntentBand} empty="No data yet." />
            <GroupTable title="By service" groups={ins.byService} empty="No data yet." />
            <GroupTable title="By language" groups={ins.byLanguage} empty="No data yet." />
          </div>
        </div>
      )}
    </>
  );
}
