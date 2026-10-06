import Link from 'next/link';
import Form from 'next/form';
import { requireSession } from '../../../lib/auth';
import { listHidden, listLeads, listServices, PAGE_SIZE, STATUSES } from '../../../lib/dashboard/queries';
import { Avatar, Badge, btn, btnPrimary, EmptyState, ErrorBanner, IntentBadge, IntentRing, input, PageHeader } from '../../../components/ui';
import { IconSparkle } from '../../../components/icons';
import { DownloadButton } from '../../../components/action-links';
import { PageStamp } from '../../../components/page-stamp';
import { SubmitButton } from '../../../components/submit-button';
import { promoteHiddenPost } from '../../actions/leads';

export const dynamic = 'force-dynamic';

type Params = { view?: string; service?: string; min?: string; status?: string; review?: string; source?: string; days?: string; label?: string; page?: string; error?: string };

function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function excerpt(text: string, n = 220): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const s = await requireSession();
  const hiddenView = p.view === 'hidden';
  const page = Math.max(1, Number(p.page) || 1);
  const services = await listServices(s);

  const qs = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...p, error: undefined, ...over })) if (v) u.set(k, v);
    const str = u.toString();
    return str ? `/leads?${str}` : '/leads';
  };

  return (
    <>
      <PageHeader title={hiddenView ? 'Hidden by AI' : 'Leads'} subtitle={hiddenView ? 'Posts the AI read but did not turn into leads. Spot a real buyer here? Make it a lead.' : 'People who asked for help, ranked by how ready they are to hire.'}>
        <Link className={hiddenView ? btn : btnPrimary} href="/leads">
          Leads
        </Link>
        <Link className={hiddenView ? btnPrimary : btn} href="/leads?view=hidden">
          Hidden by AI
        </Link>
        <DownloadButton className={btn} href={hiddenView ? '/api/leads/export?hidden=1' : '/api/leads/export'} busyLabel="Preparing the Excel file…">
          {hiddenView ? 'Export to Excel (with hidden)' : 'Export to Excel'}
        </DownloadButton>
      </PageHeader>
      <PageStamp at={new Date().toISOString()} />
      {p.error && <ErrorBanner>{p.error}</ErrorBanner>}

      {hiddenView ? (
        <HiddenList s={s} page={page} qs={qs} />
      ) : (
        <>
          <Form action="/leads" className="card mb-5 grid grid-cols-2 gap-3 p-4 md:grid-cols-6" aria-label="Filter leads">
            <select name="service" defaultValue={p.service ?? ''} className={input} aria-label="Service">
              <option value="">All services</option>
              {services.map((sv) => (
                <option key={sv.id} value={sv.slug}>
                  {sv.name}
                </option>
              ))}
              <option value="other">Other</option>
            </select>
            <select name="min" defaultValue={p.min ?? ''} className={input} aria-label="Minimum intent">
              <option value="">Any intent</option>
              <option value="90">90 and above</option>
              <option value="80">80 and above</option>
              <option value="70">70 and above</option>
              <option value="60">60 and above</option>
            </select>
            <select name="status" defaultValue={p.status ?? ''} className={input} aria-label="Status">
              <option value="">Any status</option>
              {STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            <select name="source" defaultValue={p.source ?? ''} className={input} aria-label="Source">
              <option value="">All sources</option>
              <option value="apify_threads">Threads via Apify</option>
              <option value="threads_api">Threads official API</option>
            </select>
            <select name="days" defaultValue={p.days ?? ''} className={input} aria-label="Date">
              <option value="">Any date</option>
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </select>
            <select name="label" defaultValue={p.label ?? ''} className={input} aria-label="Label">
              <option value="">Any label</option>
              <option value="none">Not labeled yet</option>
              <option value="genuine">Genuine</option>
              <option value="not_genuine">Not genuine</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="review" value="1" defaultChecked={p.review === '1'} /> Needs review
            </label>
            <div className="col-span-2 flex gap-2 md:col-span-6">
              <SubmitButton className={btnPrimary} pendingLabel="Applying…">
                Apply filters
              </SubmitButton>
              <Link className={btn} href="/leads">
                Clear
              </Link>
            </div>
          </Form>
          <LeadList s={s} p={p} page={page} qs={qs} />
        </>
      )}
    </>
  );
}

async function LeadList({ s, p, page, qs }: { s: Awaited<ReturnType<typeof requireSession>>; p: Params; page: number; qs: (o: Record<string, string | undefined>) => string }) {
  const { rows, total } = await listLeads(s, {
    service: p.service || undefined,
    minIntent: p.min ? Number(p.min) : undefined,
    status: p.status || undefined,
    needsReview: p.review === '1',
    label: p.label === 'none' || p.label === 'genuine' || p.label === 'not_genuine' ? p.label : undefined,
    source: p.source || undefined,
    days: p.days ? Number(p.days) : undefined,
    page,
  });
  if (rows.length === 0) {
    return (
      <EmptyState title={total === 0 && !Object.values(p).some(Boolean) ? 'No leads yet' : 'No leads match these filters'}>
        {Object.values(p).some(Boolean) ? 'Try clearing the filters.' : 'Run a collection from Sources & Runs.'}
      </EmptyState>
    );
  }
  const filtered = Object.entries(p).some(([k, v]) => v && k !== 'page' && k !== 'error');
  const from = (page - 1) * PAGE_SIZE + 1;
  return (
    <>
      <p className="mb-3 text-sm text-(--muted)" aria-live="polite">
        {filtered ? `${total} lead${total === 1 ? '' : 's'} match your filters` : `${total} lead${total === 1 ? '' : 's'}`}
        {total > rows.length ? ` · showing ${from} to ${from + rows.length - 1}` : ''} · highest intent first
      </p>
      <ul className="grid gap-3">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/leads/${r.id}`} className="card card-hover rise flex gap-3 p-4 sm:gap-4 sm:p-5">
              {/* The avatar is hidden on phones so the post text keeps its width. */}
              <span className="hidden sm:block">
                <Avatar name={r.author_handle ?? '?'} size={44} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">@{r.author_handle}</span>
                  <span className="text-xs text-(--muted)">{ago(r.posted_at ?? r.created_at)}</span>
                  {r.service && <Badge tone="accent">{r.service}</Badge>}
                  {r.status !== 'new' && <Badge>{r.status}</Badge>}
                  {r.needs_review && <Badge tone="warn">needs review</Badge>}
                  {r.review_label && <Badge tone={r.review_label === 'genuine' ? 'good' : 'bad'}>{r.review_label === 'genuine' ? 'genuine' : 'not genuine'}</Badge>}
                </div>
                <p className="whitespace-pre-line break-words text-[0.95rem] leading-relaxed">{excerpt(r.text ?? '')}</p>
                {r.reason && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-(--muted)">
                    <IconSparkle width={14} height={14} className="mt-px shrink-0 text-(--accent)" />
                    <span>{r.reason}</span>
                  </p>
                )}
              </div>
              <IntentRing score={r.intent_score ?? null} />
            </Link>
          </li>
        ))}
      </ul>
      <Pager page={page} total={total} href={(n) => qs({ page: String(n) })} />
    </>
  );
}

async function HiddenList({ s, page, qs }: { s: Awaited<ReturnType<typeof requireSession>>; page: number; qs: (o: Record<string, string | undefined>) => string }) {
  const { rows, total } = await listHidden(s, page);
  if (rows.length === 0) return <EmptyState title="Nothing hidden">Every classified post became a lead, or nothing was classified yet.</EmptyState>;
  return (
    <>
      <p className="mb-3 text-sm text-(--muted)">Posts the AI classified but did not turn into leads. If you see a real buyer here, press "Make a lead".</p>
      <ul className="grid gap-3">
        {rows.map((r) => (
          <li key={r.post_id} className="card rise p-4 sm:p-5">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge>{r.author_type}</Badge>
              <IntentBadge score={r.intent_score} />
              {r.language && <Badge>{r.language}</Badge>}
              <span className="ml-auto text-xs text-(--muted)">@{r.author_handle}</span>
            </div>
            <p className="whitespace-pre-line break-words text-sm">{excerpt(r.text)}</p>
            {r.reason && <p className="mt-1 text-xs text-(--muted)">AI: {r.reason}</p>}
            <div className="mt-2 flex items-center gap-3">
              <form action={promoteHiddenPost}>
                <input type="hidden" name="post_id" value={r.post_id} />
                <SubmitButton className={btn} pendingLabel="Making a lead…">
                  Make a lead
                </SubmitButton>
              </form>
              <a className="text-xs underline" href={r.post_url} target="_blank" rel="noopener noreferrer">
                Open original post
              </a>
            </div>
          </li>
        ))}
      </ul>
      <Pager page={page} total={total} href={(n) => qs({ page: String(n) })} />
    </>
  );
}

function Pager({ page, total, href }: { page: number; total: number; href: (n: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
      {page > 1 ? <Link className={btn} href={href(page - 1)}>Previous</Link> : <span />}
      <span className="text-(--muted)">Page {page} of {pages} · {total} total</span>
      {page < pages ? <Link className={btn} href={href(page + 1)}>Next</Link> : <span />}
    </nav>
  );
}
