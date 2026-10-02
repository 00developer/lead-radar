import { NextResponse, type NextRequest } from 'next/server';
import { getDb, serverEnv } from '../../../../lib/app/server';
import { realDeps } from '../../../../lib/app/deps';
import { safeEqual } from '../../../../lib/crypto';
import { runWorkspacePipeline } from '../../../../lib/pipeline/orchestrate';
import type { SourceId } from '../../../../lib/collectors/types';

export const dynamic = 'force-dynamic';
// Long runs are cut by the time budget in realDeps(). Confirm the platform limit at deploy time (see docs/memory.md).
export const maxDuration = 300;

/**
 * Scheduled run (Vercel Cron, decision D-16): collects for every workspace and every enabled source.
 * Protected by CRON_SECRET in the Authorization header. Without a valid secret nothing runs.
 */
export async function GET(request: NextRequest) {
  const secret = serverEnv().CRON_SECRET;
  const header = request.headers.get('authorization') ?? '';
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getDb();
  const deps = realDeps();
  const workspaces = await db.query<{ id: string }>('select id from workspaces order by created_at');
  const results: { workspace: string; source: string; ok: boolean; note: string }[] = [];

  for (const w of workspaces.rows) {
    const sources = await db.query<{ source: SourceId }>('select source from workspace_sources where workspace_id = $1 and enabled order by source', [w.id]);
    for (const src of sources.rows) {
      try {
        const r = await runWorkspacePipeline(db, w.id, src.source, deps);
        results.push({
          workspace: w.id, source: src.source, ok: r.ok,
          note: r.ok ? `${r.summary.collect.status}, new posts ${r.summary.collect.postsNew}, new leads ${r.summary.promote.leadsCreated}` : r.error,
        });
      } catch (e) {
        results.push({ workspace: w.id, source: src.source, ok: false, note: e instanceof Error ? e.message.slice(0, 200) : 'failed' });
      }
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
