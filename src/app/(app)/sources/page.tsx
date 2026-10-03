import Link from 'next/link';
import { requireSession } from '../../../lib/auth';
import { listRuns, listSources } from '../../../lib/dashboard/queries';
import { Badge, btn, btnDanger, btnPrimary, Card, EmptyState, ErrorBanner, input, Notice, PageHeader, RunStatus } from '../../../components/ui';
import { saveSource } from '../../actions/workspace';
import { disconnectThreads, runNow } from '../../actions/run';

export const dynamic = 'force-dynamic';
// "Run now" is a Server Action on this page: it collects and classifies in one request, which can take minutes.
export const maxDuration = 300;

const LABEL: Record<string, string> = { apify_threads: 'Threads via Apify (bridge)', threads_api: 'Threads official API' };
const NOTE: Record<string, string> = {
  apify_threads: 'Paid per post. Works today.',
  threads_api: "Free, but it returns other people's posts only after Meta approves the threads_keyword_search permission.",
};
const QUERY_LIMIT = 2200;

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; notice?: string; connected?: string }> }) {
  const p = await searchParams;
  const s = await requireSession();
  const [sources, runs] = await Promise.all([listSources(s), listRuns(s, 20)]);

  const { data: conn } = await s.supabase
    .from('threads_connections')
    .select('username,status,token_expires_at,connected_at,last_error')
    .eq('workspace_id', s.workspaceId)
    .maybeSingle();
  const { data: used } = await s.supabase
    .from('collector_runs')
    .select('queries_used')
    .eq('workspace_id', s.workspaceId)
    .eq('source', 'threads_api')
    .gte('started_at', new Date(Date.now() - 86_400_000).toISOString());
  const queriesUsed = (used ?? []).reduce((a, r) => a + (r.queries_used ?? 0), 0);
  const connected = conn?.status === 'active';

  return (
    <>
      <PageHeader title="Sources & Runs" subtitle="Where posts come from, how much a run may cost, and what happened in recent runs." />
      {p.error && <ErrorBanner>{p.error}</ErrorBanner>}
      {p.saved && <Notice>Saved.</Notice>}
      {p.notice && <Notice>{p.notice}</Notice>}
      {p.connected && <Notice>{p.connected}</Notice>}

      <Card title="Threads account" className="mb-6">
        {conn && conn.status !== 'disconnected' ? (
          <div className="grid gap-2 text-sm">
            <p>
              <strong>Connected as @{conn.username}</strong>{' '}
              <Badge tone={connected ? 'good' : 'warn'}>{conn.status.replace('_', ' ')}</Badge>
            </p>
            {conn.status === 'needs_reconnect' && (
              <ErrorBanner>
                This connection needs to be reconnected{conn.last_error ? ` (${conn.last_error})` : ''}. Apify collection keeps working meanwhile.
              </ErrorBanner>
            )}
            <p className="text-(--muted)">
              Token valid until {conn.token_expires_at ? new Date(conn.token_expires_at).toLocaleDateString() : 'unknown'} · about {queriesUsed} of {QUERY_LIMIT} searches used in the last 24 hours (the real number can be higher if you use other apps).
            </p>
          </div>
        ) : (
          <p className="text-sm text-(--muted)">No Threads account is connected. Apify collection works without one.</p>
        )}
        <p className="mt-2 text-xs text-(--muted)">The connected account is used only to search public posts. Nothing is ever posted, liked or followed from it.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className={connected ? btn : btnPrimary} href="/api/threads/connect" prefetch={false}>
            {conn && conn.status !== 'disconnected' ? 'Reconnect' : 'Connect Threads account'}
          </Link>
          {conn && conn.status !== 'disconnected' && (
            <form action={disconnectThreads}>
              <button className={btnDanger} type="submit">
                Disconnect (deletes the stored token)
              </button>
            </form>
          )}
        </div>
      </Card>

      <div className="mb-6 grid gap-4">
        {sources.map((src) => (
          <Card key={src.source} title={LABEL[src.source] ?? src.source}>
            <p className="mb-3 text-sm text-(--muted)">{NOTE[src.source]}</p>
            <form action={saveSource} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="source" value={src.source} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={src.enabled} /> Enabled
              </label>
              <label className="grid gap-1 text-sm">
                Max results per run
                <input className={`${input} w-32`} type="number" name="max_results" min={1} max={1000} defaultValue={src.max_results} />
              </label>
              <label className="grid gap-1 text-sm">
                Max spend per run (USD)
                <input className={`${input} w-32`} type="number" step="0.01" name="max_spend_usd" min={0} max={50} defaultValue={Number(src.max_spend_usd)} />
              </label>
              <button className={btn} type="submit">
                Save limits
              </button>
            </form>
            <form action={runNow} className="mt-3 border-t border-(--border) pt-3">
              <input type="hidden" name="source" value={src.source} />
              <button className={btnPrimary} type="submit" disabled={!src.enabled}>
                Run now
              </button>
              <span className="ml-3 text-xs text-(--muted)">
                Collects up to {src.max_results} posts (at most ${Number(src.max_spend_usd).toFixed(2)}), then classifies and sends alerts. It can take a few minutes; keep this tab open.
              </span>
            </form>
          </Card>
        ))}
      </div>

      <Card title="Recent runs">
        {runs.length === 0 ? (
          <EmptyState title="No runs yet">A run appears here after the first collection.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-160 text-sm">
              <thead>
                <tr className="text-left text-(--muted)">
                  <th className="pb-1 font-medium">Started</th>
                  <th className="pb-1 font-medium">Source</th>
                  <th className="pb-1 font-medium">Status</th>
                  <th className="pb-1 text-right font-medium">Returned</th>
                  <th className="pb-1 text-right font-medium">New</th>
                  <th className="pb-1 text-right font-medium">Cost</th>
                  <th className="pb-1 pl-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-(--border) align-top">
                    <td className="py-1.5">{new Date(r.started_at).toLocaleString()}</td>
                    <td className="py-1.5">{r.source}</td>
                    <td className="py-1.5">
                      <RunStatus status={r.status} />
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{r.posts_returned}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.posts_new}</td>
                    <td className="py-1.5 text-right tabular-nums">${Number(r.cost_usd).toFixed(3)}</td>
                    <td className="py-1.5 pl-3 text-(--muted)">{r.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
