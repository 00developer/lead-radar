// Database side of the Business Profile. Rules: only CONFIRMED offerings of a CONFIRMED profile ever reach the classifier;
// a re-scan never overwrites confirmed data (it becomes a pending diff the user accepts or discards).

import type { Db } from '../db/types';
import type { Offering, Suggestion } from './extract';

export type StoredOffering = { id: string; kind: 'product' | 'service'; name: string; description: string | null; source_url: string | null; origin: 'ai_extracted' | 'manual'; confirmed: boolean; service_id: string | null };
export type StoredProfile = {
  website_url: string;
  business_summary: string | null;
  status: 'draft' | 'confirmed';
  pages_fetched: string[] | null;
  last_scanned_at: Date | null;
  confirmed_at: Date | null;
  pending_scan: { summary: string; offerings: Offering[]; pages: string[]; notes: string[] } | null;
  scan_notes: string | null;
};

export const MAX_SCANS_PER_DAY = 5;

export async function scansToday(db: Db, workspaceId: string): Promise<number> {
  const r = await db.query<{ n: string }>("select count(*) as n from ai_usage where workspace_id = $1 and kind = 'profile_scan' and created_at > now() - interval '24 hours'", [workspaceId]);
  return Number(r.rows[0].n);
}

export async function getProfile(db: Db, workspaceId: string): Promise<{ profile: StoredProfile; offerings: StoredOffering[] } | null> {
  const p = await db.query<StoredProfile>(
    'select website_url, business_summary, status, pages_fetched, last_scanned_at, confirmed_at, pending_scan, scan_notes from business_profiles where workspace_id = $1',
    [workspaceId],
  );
  if (!p.rows[0]) return null;
  const o = await db.query<StoredOffering>(
    'select id, kind, name, description, source_url, origin, confirmed, service_id from business_offerings where workspace_id = $1 order by confirmed desc, created_at, name',
    [workspaceId],
  );
  return { profile: p.rows[0], offerings: o.rows };
}

/** What the classifier gets: null unless the profile is confirmed and has at least one confirmed offering. */
export async function loadConfirmedProfile(db: Db, workspaceId: string): Promise<{ summary: string | null; offerings: { id: string; name: string; kind: string; description: string | null }[] } | null> {
  const p = await db.query<{ business_summary: string | null }>("select business_summary from business_profiles where workspace_id = $1 and status = 'confirmed'", [workspaceId]);
  if (!p.rows[0]) return null;
  const o = await db.query<{ id: string; name: string; kind: string; description: string | null }>(
    'select id, name, kind, description from business_offerings where workspace_id = $1 and confirmed order by created_at, name',
    [workspaceId],
  );
  if (o.rows.length === 0) return null;
  return { summary: p.rows[0].business_summary, offerings: o.rows };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Saves the result of a scan. First scan (or a profile that is not confirmed yet): it becomes the draft, replacing older
 * unconfirmed AI drafts. A confirmed profile is never touched: the result is kept as a pending re-scan for review.
 */
export async function saveScan(db: Db, workspaceId: string, s: { url: string; summary: string; offerings: Offering[]; pages: string[]; notes: string[] }): Promise<'draft' | 'pending'> {
  const existing = await db.query<{ status: string }>('select status from business_profiles where workspace_id = $1', [workspaceId]);
  const confirmed = existing.rows[0]?.status === 'confirmed';

  if (confirmed) {
    await db.query('update business_profiles set pending_scan = $2::jsonb, last_scanned_at = now(), scan_notes = $3 where workspace_id = $1', [
      workspaceId, JSON.stringify({ summary: s.summary, offerings: s.offerings, pages: s.pages, notes: s.notes }), s.notes.join(' '),
    ]);
    return 'pending';
  }
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into business_profiles (workspace_id, website_url, business_summary, status, pages_fetched, last_scanned_at, scan_notes)
       values ($1,$2,$3,'draft',$4::jsonb, now(), $5)
       on conflict (workspace_id) do update set website_url = excluded.website_url, business_summary = excluded.business_summary,
         pages_fetched = excluded.pages_fetched, last_scanned_at = now(), scan_notes = excluded.scan_notes, pending_scan = null`,
      [workspaceId, s.url, s.summary, JSON.stringify(s.pages), s.notes.join(' ')],
    );
    await tx.query("delete from business_offerings where workspace_id = $1 and not confirmed and origin = 'ai_extracted'", [workspaceId]);
    for (const o of s.offerings) {
      await tx.query('insert into business_offerings (workspace_id, kind, name, description, source_url, origin, confirmed) values ($1,$2,$3,$4,$5,\'ai_extracted\',false)', [
        workspaceId, o.kind, o.name, o.description || null, o.sourceUrl,
      ]);
    }
  });
  return 'draft';
}

/** Starts a profile without a scan (the user types the offerings). */
export async function ensureProfile(db: Db, workspaceId: string, url: string): Promise<void> {
  await db.query("insert into business_profiles (workspace_id, website_url, status) values ($1,$2,'draft') on conflict (workspace_id) do update set website_url = excluded.website_url", [workspaceId, url]);
}

export async function updateOffering(db: Db, workspaceId: string, id: string, v: { name: string; description: string; kind: 'product' | 'service'; serviceId: string | null }): Promise<void> {
  // An edited offering has to be confirmed again, so nothing changes silently for the classifier.
  await db.query(
    `update business_offerings set name = $3, description = $4, kind = $5, confirmed = false,
            service_id = (select id from workspace_services where id = $6 and workspace_id = $1)
      where workspace_id = $1 and id = $2`,
    [workspaceId, id, v.name, v.description || null, v.kind, v.serviceId],
  );
}

export async function deleteOffering(db: Db, workspaceId: string, id: string): Promise<void> {
  await db.query('delete from business_offerings where workspace_id = $1 and id = $2', [workspaceId, id]);
}

export async function addManualOffering(db: Db, workspaceId: string, v: { name: string; description: string; kind: 'product' | 'service' }): Promise<void> {
  await db.query("insert into business_offerings (workspace_id, kind, name, description, origin, confirmed) values ($1,$2,$3,$4,'manual',false)", [workspaceId, v.kind, v.name, v.description || null]);
}

/** The user reviewed the list: every offering that is still on the list is confirmed, and the summary is saved. */
export async function confirmProfile(db: Db, workspaceId: string, summary: string): Promise<{ confirmed: number }> {
  return db.transaction(async (tx) => {
    const up = await tx.query("update business_offerings set confirmed = true where workspace_id = $1 and not confirmed", [workspaceId]);
    const cnt = await tx.query<{ n: string }>('select count(*) as n from business_offerings where workspace_id = $1 and confirmed', [workspaceId]);
    if (Number(cnt.rows[0].n) === 0) throw new Error('Add at least one product or service before confirming.');
    await tx.query("update business_profiles set status = 'confirmed', confirmed_at = now(), business_summary = $2 where workspace_id = $1", [workspaceId, summary]);
    return { confirmed: up.rowCount };
  });
}

// ---- re-scan diff ----------------------------------------------------------------------------------

export type ScanDiff = { added: Offering[]; removed: StoredOffering[]; changed: { name: string; before: string; after: string }[] };

export function diffScan(current: StoredOffering[], pending: Offering[]): ScanDiff {
  const cur = new Map(current.map((c) => [norm(c.name), c]));
  const pen = new Map(pending.map((p) => [norm(p.name), p]));
  const added = pending.filter((p) => !cur.has(norm(p.name)));
  const removed = current.filter((c) => c.origin === 'ai_extracted' && !pen.has(norm(c.name)));
  const changed: ScanDiff['changed'] = [];
  for (const [k, p] of pen) {
    const c = cur.get(k);
    if (c && norm(c.description ?? '') !== norm(p.description)) changed.push({ name: c.name, before: c.description ?? '', after: p.description });
  }
  return { added, removed, changed };
}

/** Accepting adds the NEW items as unconfirmed drafts. Nothing confirmed is removed or changed. */
export async function acceptPendingScan(db: Db, workspaceId: string): Promise<{ added: number }> {
  const got = await getProfile(db, workspaceId);
  const pending = got?.profile.pending_scan;
  if (!got || !pending) return { added: 0 };
  const { added } = diffScan(got.offerings, pending.offerings);
  await db.transaction(async (tx) => {
    for (const o of added) {
      await tx.query("insert into business_offerings (workspace_id, kind, name, description, source_url, origin, confirmed) values ($1,$2,$3,$4,$5,'ai_extracted',false)", [
        workspaceId, o.kind, o.name, o.description || null, o.sourceUrl,
      ]);
    }
    await tx.query('update business_profiles set pending_scan = null, pages_fetched = $2::jsonb where workspace_id = $1', [workspaceId, JSON.stringify(pending.pages)]);
  });
  return { added: added.length };
}

export async function discardPendingScan(db: Db, workspaceId: string): Promise<void> {
  await db.query('update business_profiles set pending_scan = null where workspace_id = $1', [workspaceId]);
}

// ---- keyword suggestions ---------------------------------------------------------------------------

export async function saveSuggestions(db: Db, workspaceId: string, list: Suggestion[]): Promise<number> {
  let n = 0;
  for (const s of list) {
    const r = await db.query(
      'insert into keyword_suggestions (workspace_id, term, language, is_negative, service_slug) values ($1,$2,$3,$4,$5) on conflict (workspace_id, term, is_negative) do nothing',
      [workspaceId, s.term, s.language, s.isNegative, s.serviceSlug],
    );
    n += r.rowCount;
  }
  return n;
}

export async function listSuggestions(db: Db, workspaceId: string) {
  return (await db.query<{ id: string; term: string; language: string; is_negative: boolean; service_slug: string | null }>(
    'select id, term, language, is_negative, service_slug from keyword_suggestions where workspace_id = $1 order by is_negative, term', [workspaceId],
  )).rows;
}

/** Approving turns the suggestion into a real keyword and removes it from the list. */
export async function approveSuggestion(db: Db, workspaceId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const s = await tx.query<{ term: string; language: string; is_negative: boolean; service_slug: string | null }>(
      'delete from keyword_suggestions where workspace_id = $1 and id = $2 returning term, language, is_negative, service_slug', [workspaceId, id],
    );
    const k = s.rows[0];
    if (!k) return false;
    await tx.query(
      `insert into keywords (workspace_id, service_id, term, language, is_negative, enabled)
       values ($1, (select id from workspace_services where workspace_id = $1 and slug = $2), $3, $4, $5, true)
       on conflict (workspace_id, term, is_negative) do nothing`,
      [workspaceId, k.service_slug, k.term, k.language, k.is_negative],
    );
    return true;
  });
}

export async function rejectSuggestion(db: Db, workspaceId: string, id: string): Promise<void> {
  await db.query('delete from keyword_suggestions where workspace_id = $1 and id = $2', [workspaceId, id]);
}
