import { NextResponse, type NextRequest } from 'next/server';
import { getDb, serverEnv } from '../../../../lib/app/server';
import { safeEqual, decryptSecret } from '../../../../lib/crypto';
import type { Db } from '../../../../lib/db/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // short duration, just sending one batch

export async function GET(request: NextRequest) {
  const secret = serverEnv().CRON_SECRET;
  const header = request.headers.get('authorization') ?? '';
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getDb();
  
  // Find one pending message per workspace that is ready to be sent
  // (We process one message per workspace per cron tick to enforce the delay)
  const pendingMessages = await db.query<{
    id: string;
    workspace_id: string;
    post_id: string;
    message_text: string;
    access_token_encrypted: string;
    username: string;
  }>(`
    select m.id, m.workspace_id, m.post_id, m.message_text, t.access_token_encrypted, t.username
      from outbound_messages m
      join threads_connections t on m.workspace_id = t.workspace_id
     where m.status = 'pending' 
       and m.scheduled_for <= now()
       and t.status = 'active'
       and t.access_token_encrypted is not null
       and m.id in (
         select id from (
           select id, row_number() over (partition by workspace_id order by scheduled_for asc) as rn
           from outbound_messages
           where status = 'pending' and scheduled_for <= now()
         ) sub where rn = 1
       )
  `);

  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const msg of pendingMessages.rows) {
    let ok = false;
    let errorStr = '';
    try {
      const accessToken = decryptSecret(msg.access_token_encrypted, serverEnv().ENCRYPTION_KEY);
      
      const res = await fetch('https://graph.threads.net/v1.0/me/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'TEXT',
          text: msg.message_text,
          reply_to_id: msg.post_id,
          access_token: accessToken,
        })
      });
      
      if (!res.ok) {
        let detail = '';
        try {
          const body = await res.json() as { error?: { message?: string } };
          detail = body?.error?.message ?? '';
        } catch {}
        throw new Error(`Threads API returned ${res.status}: ${detail}`);
      }
      
      const data = await res.json() as { id?: string };
      if (!data.id) throw new Error('Threads API returned success but no container ID');
      
      const publishRes = await fetch('https://graph.threads.net/v1.0/me/threads_publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: data.id,
          access_token: accessToken,
        })
      });

      if (!publishRes.ok) {
        let detail = '';
        try {
          const body = await publishRes.json() as { error?: { message?: string } };
          detail = body?.error?.message ?? '';
        } catch {}
        throw new Error(`Threads API publish returned ${publishRes.status}: ${detail}`);
      }

      ok = true;
    } catch (e) {
      errorStr = e instanceof Error ? e.message.slice(0, 500) : 'Unknown error';
    }

    if (ok) {
      await db.query("update outbound_messages set status = 'sent', sent_at = now() where id = $1", [msg.id]);
    } else {
      await db.query("update outbound_messages set status = 'failed', error_note = $1 where id = $2", [errorStr, msg.id]);
    }
    
    results.push({ id: msg.id, ok, error: errorStr || undefined });
  }

  return NextResponse.json({ processed: results.length, results });
}
