// Sends alert emails for new leads at or above the alert threshold (once per lead).
//
// Usage:
//   npm run alerts -- --dry-run           list who would get an email, send nothing
//   npm run alerts -- --send-test-email   send one test email to the alert address to check EMAIL_API_KEY and ALERT_FROM_EMAIL
//   npm run alerts                        send real alerts (at most 5 per run)
// Flags: --workspace <id>

import { createResendChannel } from '../lib/alerts/email';
import { runAlerts } from '../lib/pipeline/alert-stage';
import { loadWorkspace, resolveWorkspaceId } from '../lib/pipeline/workspace';
import { requireValue } from '../lib/env';
import { loadEnv, openDb, parseArgs, run, strArg } from './common';

run(async () => {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const db = openDb(env);
  try {
    const ws = await loadWorkspace(db, await resolveWorkspaceId(db, strArg(args, 'workspace')));
    console.log(`Workspace: ${ws.name}. Alert threshold ${ws.settings.alertThreshold}. Alert email: ${ws.settings.alertEmail ?? '(not set: add it in Settings)'}`);

    if (args['dry-run'] === true) {
      const r = await db.query<{ id: string; intent_score: number; author_handle: string }>(
        `select l.id, c.intent_score, p.author_handle from leads l
           join classifications c on c.id = l.classification_id join posts p on p.id = l.post_id
           left join alerts a on a.lead_id = l.id and a.channel = 'email'
          where l.workspace_id = $1 and l.status = 'new' and c.intent_score >= $2 and (a.id is null or a.status = 'failed')
          order by c.intent_score desc limit 20`,
        [ws.id, ws.settings.alertThreshold],
      );
      console.log(`\nDry run. ${r.rows.length} lead(s) would get an email (the real run sends at most 5):`);
      for (const l of r.rows) console.log(`  intent ${l.intent_score}  @${l.author_handle}  ${l.id}`);
      return;
    }

    const channel = createResendChannel({
      apiKey: requireValue(env.EMAIL_API_KEY, 'EMAIL_API_KEY'),
      from: requireValue(env.ALERT_FROM_EMAIL, 'ALERT_FROM_EMAIL'),
    });
    const appUrl = env.APP_URL ?? 'http://localhost:3000';

    if (args['send-test-email'] === true) {
      const to = requireValue(ws.settings.alertEmail ?? undefined, 'the alert email in Settings');
      const res = await channel.send({ key: `test-${Date.now()}`, to, subject: 'Lead Radar test email', text: 'If you can read this, alert emails work.', html: '<p>If you can read this, alert emails work.</p>' });
      console.log(res.ok ? `Test email sent to ${to}.` : `FAILED: ${res.error}`);
      if (!res.ok) process.exitCode = 1;
      return;
    }

    const s = await runAlerts(db, ws, { channel, appUrl, alertEmail: ws.settings.alertEmail });
    console.log(s.skipped ? `Skipped: ${s.skipped}` : `Candidates ${s.candidates}, sent ${s.sent}, failed ${s.failed}.`);
    if (s.failed > 0) process.exitCode = 1;
  } finally {
    await db.close();
  }
});
