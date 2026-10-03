import { requireSession } from '../../../lib/auth';
import { getDb } from '../../../lib/app/server';
import { diffScan, getProfile, listSuggestions, MAX_SCANS_PER_DAY, scansToday } from '../../../lib/profile/store';
import { listServices } from '../../../lib/dashboard/queries';
import { LocalTime } from '../../../components/local-time';
import { Badge, btn, btnDanger, btnPrimary, Card, ErrorBanner, input, Notice, PageHeader } from '../../../components/ui';
import {
  acceptRescan, addOffering, analyzeText, confirmList, decideSuggestion, discardRescan, removeOffering, saveOffering, scanWebsite, startManually, suggestKeywordsAction,
} from '../../actions/profile';

export const dynamic = 'force-dynamic';

function PasteCard() {
  return (
    <Card title="Or paste the text of your services page" className="mb-4">
      <p className="mb-3 text-sm text-(--muted)">
        Works for every website, including ones that hide their text behind JavaScript. Copy the text of your services or home page, paste it here, and the AI lists your products and services. Nothing is fetched.
      </p>
      <form action={analyzeText} className="grid gap-3">
        <textarea className={input} name="text" rows={7} minLength={200} maxLength={30000} placeholder="Paste at least a few paragraphs about what you sell…" aria-label="Text of your services page" required />
        <div>
          <button className={btn} type="submit">
            Analyse this text
          </button>
        </div>
      </form>
    </Card>
  );
}

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const p = await searchParams;
  const s = await requireSession();
  const db = getDb();
  let loaded;
  try {
    loaded = await Promise.all([getProfile(db, s.workspaceId), listServices(s), listSuggestions(db, s.workspaceId), scansToday(db, s.workspaceId)]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    return (
      <>
        <PageHeader title="Business Profile" subtitle="Tell the AI what your business sells, so leads are matched to your real products and services." />
        <ErrorBanner>
          {/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/.test(msg)
            ? 'The database cannot be reached from this network. The direct Supabase address needs IPv6. Switch to a network with IPv6 (a phone hotspot usually works) or use the Supabase session pooler address in DATABASE_URL, then reload this page.'
            : 'This page could not load its data. Please reload. If it keeps happening, check DATABASE_URL in .env.'}
        </ErrorBanner>
      </>
    );
  }
  const [got, services, suggestions, scans] = loaded;

  const banners = (
    <>
      {p.error && <ErrorBanner>{p.error}</ErrorBanner>}
      {p.notice && <Notice>{p.notice}</Notice>}
    </>
  );

  if (!got) {
    return (
      <>
        <PageHeader title="Business Profile" subtitle="Tell the AI what your business sells, so leads are matched to your real products and services." />
        {banners}
        <p className="mb-4 max-w-2xl text-sm text-(--muted)">
          Enter your website. The tool reads a few public pages and lists the products and services you sell. You review and edit the list; nothing is used until you confirm it. It only lists products and services (no SEO or technical audit).
        </p>
        <Card title="Scan your website" className="mb-4">
          <form action={scanWebsite} className="flex flex-wrap items-end gap-3">
            <label className="grid flex-1 gap-1 text-sm">
              Website address
              <input className={input} name="url" placeholder="yourcompany.com" required />
            </label>
            <button className={btnPrimary} type="submit">
              Scan website
            </button>
          </form>
          <p className="mt-2 text-xs text-(--muted)">Up to 12 public pages are read, respecting robots.txt. Private or internal addresses are refused. The scan can take up to a minute. {MAX_SCANS_PER_DAY} scans per day.</p>
        </Card>
        <PasteCard />
        <Card title="Or start with an empty list">
          <form action={startManually} className="flex flex-wrap items-end gap-3">
            <button className={btn} type="submit">
              Add products and services by hand
            </button>
          </form>
        </Card>
      </>
    );
  }

  const { profile, offerings } = got;
  const pending = profile.pending_scan;
  const diff = pending ? diffScan(offerings, pending.offerings) : null;
  const confirmedCount = offerings.filter((o) => o.confirmed).length;
  const unconfirmed = offerings.length - confirmedCount;

  return (
    <>
      <PageHeader title="Business Profile" subtitle="Only confirmed items are given to the AI.">
        <Badge tone={profile.status === 'confirmed' ? 'good' : 'warn'}>{profile.status === 'confirmed' ? 'confirmed' : 'draft: not used yet'}</Badge>
      </PageHeader>
      {banners}
      <p className="mb-4 text-sm text-(--muted)">
        Website: {profile.website_url}
        {profile.last_scanned_at ? <> · last scanned <LocalTime value={profile.last_scanned_at} /></> : null}
        {profile.pages_fetched ? ` · ${profile.pages_fetched.length} page(s) read` : ''}
      </p>
      {profile.scan_notes && <p className="mb-4 text-xs text-(--muted)">{profile.scan_notes}</p>}

      {pending && diff && (
        <Card title="Re-scan: review the changes" className="mb-4">
          <p className="mb-2 text-sm">Your confirmed list is unchanged. Accepting adds only the new items, as drafts you confirm yourself.</p>
          <ul className="mb-3 grid gap-1 text-sm">
            {diff.added.map((o) => <li key={o.name}><Badge tone="good">new</Badge> {o.name}{o.description ? `: ${o.description}` : ''}</li>)}
            {diff.changed.map((c) => <li key={c.name}><Badge tone="warn">changed</Badge> {c.name}: “{c.before}” → “{c.after}”</li>)}
            {diff.removed.map((o) => <li key={o.id}><Badge>not found now</Badge> {o.name} (kept)</li>)}
            {diff.added.length + diff.changed.length + diff.removed.length === 0 && <li className="text-(--muted)">No differences.</li>}
          </ul>
          <div className="flex gap-2">
            <form action={acceptRescan}><button className={btnPrimary} type="submit">Accept new items</button></form>
            <form action={discardRescan}><button className={btn} type="submit">Discard</button></form>
          </div>
        </Card>
      )}

      <form action={confirmList} className="mb-4">
        <Card title="What the business does (used by the AI)">
          <textarea className={input} name="summary" rows={3} maxLength={800} defaultValue={profile.business_summary ?? ''} aria-label="Business summary" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className={btnPrimary} type="submit">
              {profile.status === 'confirmed' && unconfirmed === 0 ? 'Save summary' : `Confirm this list (${offerings.length} item${offerings.length === 1 ? '' : 's'})`}
            </button>
            <span className="text-xs text-(--muted)">
              {confirmedCount} confirmed, {unconfirmed} waiting. Only confirmed items are given to the AI. Reply drafts never mention anything outside this list.
            </span>
          </div>
        </Card>
      </form>

      <Card title="Products and services" className="mb-4">
        {offerings.length === 0 ? (
          <p className="text-sm text-(--muted)">The list is empty. Add items below.</p>
        ) : (
          <ul className="grid gap-4">
            {offerings.map((o) => (
              <li key={o.id} className="border-t border-(--border) pt-3 first:border-t-0 first:pt-0">
                <form action={saveOffering} className="grid gap-2 md:grid-cols-6">
                  <input type="hidden" name="id" value={o.id} />
                  <input className={`${input} md:col-span-2`} name="name" defaultValue={o.name} aria-label="Name" />
                  <input className={`${input} md:col-span-2`} name="description" defaultValue={o.description ?? ''} aria-label="Description" />
                  <select className={input} name="kind" defaultValue={o.kind} aria-label="Kind">
                    <option value="service">service</option>
                    <option value="product">product</option>
                  </select>
                  <select className={`${input} md:col-span-2`} name="service" defaultValue={o.service_id ?? ''} aria-label="Matches which of your services">
                    <option value="">No service link</option>
                    {services.map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
                  </select>
                  <div className="flex items-center gap-2 md:col-span-4">
                    <button className={btn} type="submit">Save</button>
                    <Badge tone={o.confirmed ? 'good' : 'warn'}>{o.confirmed ? 'confirmed' : 'needs confirming'}</Badge>
                    <Badge>{o.origin === 'manual' ? 'added by hand' : 'from website'}</Badge>
                    {o.source_url && <a className="text-xs underline" href={o.source_url} target="_blank" rel="noopener noreferrer">source page</a>}
                  </div>
                </form>
                <form action={removeOffering} className="mt-1">
                  <input type="hidden" name="id" value={o.id} />
                  <button className={btnDanger} type="submit" aria-label={`Remove ${o.name}`}>Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addOffering} className="mt-4 grid gap-2 border-t border-(--border) pt-4 md:grid-cols-6">
          <input className={`${input} md:col-span-2`} name="name" placeholder="Name, for example Mobile app development" aria-label="New item name" required />
          <input className={`${input} md:col-span-2`} name="description" placeholder="Short description" aria-label="New item description" />
          <select className={input} name="kind" aria-label="New item kind"><option value="service">service</option><option value="product">product</option></select>
          <button className={btn} type="submit">Add item</button>
        </form>
      </Card>

      <Card title="Scan again" className="mb-4">
        <form action={scanWebsite} className="flex flex-wrap items-end gap-3">
          <label className="grid flex-1 gap-1 text-sm">
            Website address
            <input className={input} name="url" defaultValue={profile.website_url.startsWith('(') ? '' : profile.website_url} placeholder="yourcompany.com" required />
          </label>
          <button className={btn} type="submit">Scan website</button>
        </form>
        <p className="mt-2 text-xs text-(--muted)">{scans} of {MAX_SCANS_PER_DAY} scans used in the last 24 hours. A re-scan never overwrites your confirmed list.</p>
      </Card>

      <PasteCard />

      <Card title="Keyword suggestions">
        {profile.status !== 'confirmed' ? (
          <p className="text-sm text-(--muted)">Confirm your list first. Keywords are suggested from the confirmed products and services.</p>
        ) : (
          <>
            <form action={suggestKeywordsAction} className="mb-3"><button className={btnPrimary} type="submit">Suggest keywords</button></form>
            {suggestions.length === 0 ? (
              <p className="text-sm text-(--muted)">No pending suggestions.</p>
            ) : (
              <ul className="grid gap-2">
                {suggestions.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{k.term}</span>
                    <Badge>{k.language}</Badge>
                    {k.is_negative && <Badge tone="warn">negative</Badge>}
                    {k.service_slug && <Badge>{k.service_slug}</Badge>}
                    <span className="ml-auto flex gap-2">
                      <form action={decideSuggestion}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="decision" value="approve" /><button className={btn} type="submit">Approve</button></form>
                      <form action={decideSuggestion}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="decision" value="reject" /><button className={btn} type="submit">Reject</button></form>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </>
  );
}
