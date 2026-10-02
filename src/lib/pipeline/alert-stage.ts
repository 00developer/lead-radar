// Stage 5: alert (docs/architecture.md section 7). One email per lead, once only.
//
// "Once only" is enforced by the database: alerts has a unique (lead_id, channel) row that is claimed BEFORE sending.
// A failed send keeps its row with status 'failed' and is retried on a later run. A claim that never finished (crash) can be
// taken over after 10 minutes. A per-run cap stops a flood when alerts are switched on with many existing leads.

import type { Db } from '../db/types';
import type { AlertChannel } from '../alerts/channel';
import { buildLeadEmail, type AlertLead } from '../alerts/compose';
import type { WorkspaceContext } from './workspace';

export type AlertSummary = { candidates: number; sent: number; failed: number; skipped: string | null };

export type AlertOptions = { channel: AlertChannel; appUrl: string; alertEmail: string | null; maxPerRun?: number; maxAgeHours?: number };

type Candidate = AlertLead & { intent_score: number };

export async function runAlerts(db: Db, ws: WorkspaceContext, o: AlertOptions): Promise<AlertSummary> {
  const summary: AlertSummary = { candidates: 0, sent: 0, failed: 0, skipped: null };
  if (!o.alertEmail) {
    summary.skipped = 'No alert email address is set in Settings.';
    return summary;
  }
  const cap = o.maxPerRun ?? 5;
  const maxAge = o.maxAgeHours ?? 72;

  const found = await db.query<Candidate>(
    `select l.id, c.service, c.intent_score, p.author_handle, c.reason, p.text, p.url as post_url,
            coalesce(l.reply_draft_edited, c.reply_draft) as reply_draft, l.needs_review
       from leads l
       join classifications c on c.id = l.classification_id and c.workspace_id = l.workspace_id
       join posts p on p.id = l.post_id and p.workspace_id = l.workspace_id
       left join alerts a on a.lead_id = l.id and a.channel = $2
      where l.workspace_id = $1
        and l.status = 'new'
        and c.intent_score >= $3
        and l.created_at > now() - make_interval(hours => $4::int)
        and (a.id is null or (a.status = 'failed' and (a.error is distinct from 'sending' or a.sent_at < now() - interval '10 minutes')))
      order by c.intent_score desc, l.created_at
      limit $5`,
    [ws.id, o.channel.id, ws.settings.alertThreshold, maxAge, cap],
  );
  summary.candidates = found.rows.length;

  for (const lead of found.rows) {
    // Claim the row. Only one caller can win: a new row, or a failed row that is not being sent right now.
    const claim = await db.query(
      `insert into alerts (workspace_id, lead_id, channel, status, error) values ($1,$2,$3,'failed','sending')
       on conflict (lead_id, channel) do update set status = 'failed', error = 'sending', sent_at = now()
        where alerts.status = 'failed' and (alerts.error is distinct from 'sending' or alerts.sent_at < now() - interval '10 minutes')
       returning id`,
      [ws.id, lead.id, o.channel.id],
    );
    if (claim.rowCount === 0) continue; // someone else has it

    const mail = buildLeadEmail(lead, o.appUrl);
    const res = await o.channel.send({ key: `lead-alert-${lead.id}`, to: o.alertEmail, ...mail });
    if (res.ok) {
      await db.query("update alerts set status = 'sent', error = null, sent_at = now() where lead_id = $1 and channel = $2 and workspace_id = $3", [lead.id, o.channel.id, ws.id]);
      await db.query("insert into lead_events (lead_id, workspace_id, event, to_value) values ($1,$2,'alerted',$3)", [lead.id, ws.id, o.channel.id]);
      summary.sent += 1;
    } else {
      await db.query("update alerts set status = 'failed', error = $4 where lead_id = $1 and channel = $2 and workspace_id = $3", [lead.id, o.channel.id, ws.id, res.error]);
      summary.failed += 1;
    }
  }
  return summary;
}
