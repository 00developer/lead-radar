import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '../../../../lib/auth';
import { getDb } from '../../../../lib/app/server';
import { loadWorkspace } from '../../../../lib/pipeline/workspace';
import { loadExportRows } from '../../../../lib/pipeline/export';
import { buildLeadsWorkbook } from '../../../../lib/pipeline/export-xlsx';

export const dynamic = 'force-dynamic';

/** Hosting platforms cap the size of a response, so one download holds at most this many rows per sheet. */
const EXPORT_ROW_LIMIT = 2000;

/**
 * Downloads the signed-in user's workspace leads as an Excel file (?hidden=1 adds a sheet with the posts the AI hid).
 * The workspace comes from the verified session, never from the request, so one workspace cannot export another's data.
 */
export async function GET(request: NextRequest) {
  const s = await requireSession(); // redirects to /login when not signed in
  const db = getDb();
  const ws = await loadWorkspace(db, s.workspaceId);
  const includeHidden = request.nextUrl.searchParams.get('hidden') === '1';
  const data = await loadExportRows(db, ws, { includeHidden, limit: EXPORT_ROW_LIMIT });
  const file = await buildLeadsWorkbook(data, {
    workspaceName: ws.name, includeHidden, capped: data.leads.length >= EXPORT_ROW_LIMIT || data.hidden.length >= EXPORT_ROW_LIMIT,
  });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="lead-radar-${includeHidden ? 'with-hidden-' : ''}${day}.xlsx"`,
      'cache-control': 'private, no-store',
    },
  });
}
