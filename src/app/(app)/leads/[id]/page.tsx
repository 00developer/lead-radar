import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../../lib/auth';
import { getLead, nextUnlabeledLeadId, STATUSES } from '../../../../lib/dashboard/queries';
import { extractContactHints, hasAnyHint } from '../../../../lib/contact-hints';
import { Avatar, Badge, btn, btnPrimary, Card, ErrorBanner, IntentBadge, IntentRing, input, Notice } from '../../../../components/ui';
import { saveLeadNotes, saveReplyDraft, setLeadStatus, setReviewLabel } from '../../../actions/leads';
import { LocalTime } from '../../../../components/local-time';
import { ReplyBox, Shortcuts } from './lead-tools';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-t border-(--border) py-1.5 text-sm first:border-t-0">
      <dt className="shrink-0 text-(--muted)">{label}</dt>
      <dd className="min-w-0 wrap-break-word text-right">{children}</dd>
    </div>
  );
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  if (!UUID.test(id)) notFound();
  const s = await requireSession();
  const found = await getLead(s, id);
  if (!found) notFound();
  const { lead, events } = found;
  const nextId = await nextUnlabeledLeadId(s, lead.id);
  const hints = extractContactHints(lead.text, lead.author_bio);
  const profile = lead.author_profile_url ?? `https://www.threads.com/@${lead.author_handle}`;

  return (
    <>
      <Shortcuts statusForms={STATUSES.map((st) => `status-${st}`)} />
      <p className="mb-3 text-sm">
        <Link href="/leads" className="underline">
          ← All leads
        </Link>
      </p>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {saved === 'notes' && <Notice>Notes saved.</Notice>}
      {saved === 'reply' && <Notice>Reply draft saved.</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <div className="mb-4 flex items-center gap-4">
              <Avatar name={lead.author_handle} size={52} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold">
                  <a className="hover:underline" href={profile} target="_blank" rel="noopener noreferrer">
                    @{lead.author_handle}
                  </a>
                  {lead.author_name ? <span className="font-normal text-(--muted)"> · {lead.author_name}</span> : null}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {lead.service && <Badge tone="accent">{lead.service}</Badge>}
                  {lead.needs_review && <Badge tone="warn">needs review</Badge>}
                  <span className="text-xs text-(--muted)">
                    {lead.source === 'apify_threads' ? 'Threads via Apify' : 'Threads official API'}
                    {lead.posted_at ? <> · posted <LocalTime value={lead.posted_at} /></> : null}
                  </span>
                </div>
              </div>
              <IntentRing score={lead.intent_score} size={60} />
            </div>
            {/* Post text is untrusted: rendered as escaped text only, never as HTML. */}
            <p className="whitespace-pre-wrap wrap-break-word text-base">{lead.text}</p>
            <p className="mt-3 text-sm">
              <a className="underline" href={lead.post_url} target="_blank" rel="noopener noreferrer">
                Open original post
              </a>
            </p>
          </Card>

          <Card>
            <ReplyBox leadId={lead.id} initial={lead.reply_draft_edited ?? lead.reply_draft ?? ''} save={saveReplyDraft} />
          </Card>

          <Card title="Notes">
            <form action={saveLeadNotes} className="grid gap-2">
              <input type="hidden" name="id" value={lead.id} />
              <textarea name="notes" defaultValue={lead.notes ?? ''} rows={4} maxLength={5000} className={input} aria-label="Notes" />
              <div>
                <button className={btn} type="submit">
                  Save notes
                </button>
              </div>
            </form>
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <Card title="AI analysis">
            <dl>
              <Row label="Type">{lead.author_type}</Row>
              <Row label="Intent">
                <IntentBadge score={lead.intent_score} />
              </Row>
              <Row label="Urgency">{lead.urgency ?? '—'}</Row>
              <Row label="Budget">{lead.budget ?? '—'}</Row>
              <Row label="Timeline">{lead.timeline ?? '—'}</Row>
              <Row label="Language">{lead.language ?? '—'}</Row>
              <Row label="Confidence">{lead.confidence !== null ? Number(lead.confidence).toFixed(2) : '—'}</Row>
              {lead.fit && <Row label="Fit">{lead.fit}</Row>}
            </dl>
            {lead.reason && <p className="mt-2 text-sm text-(--muted)">{lead.reason}</p>}
          </Card>

          <Card title="Contact hints">
            {hasAnyHint(hints) ? (
              <ul className="grid gap-1 text-sm break-all">
                {hints.emails.map((e) => <li key={e}>Email: {e}</li>)}
                {hints.phones.map((p) => <li key={p}>Phone: {p}</li>)}
                {hints.whatsapp && <li>Mentions WhatsApp</li>}
                {hints.links.map((l) => <li key={l}>Link: {l}</li>)}
              </ul>
            ) : (
              <p className="text-sm text-(--muted)">No public contact info. Reply under the post or send a DM by hand.</p>
            )}
          </Card>

          <Card title="Status">
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((st, i) => (
                <form key={st} id={`status-${st}`} action={setLeadStatus}>
                  <input type="hidden" name="id" value={lead.id} />
                  <input type="hidden" name="status" value={st} />
                  <button type="submit" className={lead.status === st ? btnPrimary : btn} aria-pressed={lead.status === st} title={`Shortcut: ${i + 1}`}>
                    {st}
                  </button>
                </form>
              ))}
            </div>
          </Card>

          <Card title="Is this a real lead?">
            <div className="flex flex-wrap gap-2">
              <form id="label-genuine" action={setReviewLabel}>
                <input type="hidden" name="id" value={lead.id} />
                <input type="hidden" name="label" value="genuine" />
                <button type="submit" className={lead.review_label === 'genuine' ? btnPrimary : btn} aria-pressed={lead.review_label === 'genuine'}>
                  Genuine lead (G)
                </button>
              </form>
              <form id="label-not" action={setReviewLabel}>
                <input type="hidden" name="id" value={lead.id} />
                <input type="hidden" name="label" value="not_genuine" />
                <button type="submit" className={lead.review_label === 'not_genuine' ? btnPrimary : btn} aria-pressed={lead.review_label === 'not_genuine'}>
                  Not a real lead (N)
                </button>
              </form>
              {lead.review_label && (
                <form action={setReviewLabel}>
                  <input type="hidden" name="id" value={lead.id} />
                  <input type="hidden" name="label" value="clear" />
                  <button type="submit" className={btn}>
                    Clear
                  </button>
                </form>
              )}
            </div>
            <p className="mt-2 text-xs text-(--muted)">Your labels feed the genuine-rate number on the Overview and the Insights page.</p>
            {nextId && (
              <p className="mt-3 text-sm">
                <Link className="font-medium underline" href={`/leads/${nextId}`}>
                  Next lead without a label →
                </Link>
              </p>
            )}
          </Card>

          <Card title="Timeline">
            {events.length === 0 ? (
              <p className="text-sm text-(--muted)">No changes yet.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {events.map((e) => (
                  <li key={e.id}>
                    <span className="text-(--muted)"><LocalTime value={e.created_at} /></span> ·{' '}
                    {e.event === 'status_changed' ? `status ${e.from_value} → ${e.to_value}` : e.event === 'labeled' ? `label ${e.from_value ?? 'none'} → ${e.to_value ?? 'none'}` : e.event === 'note_updated' ? 'notes updated' : e.event === 'alerted' ? 'alert email sent' : e.event}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
