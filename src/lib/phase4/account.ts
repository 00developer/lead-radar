// Deleting an account. The login is removed first (that also removes the membership), then the workspace if nobody is left in it.
// Deleting the workspace removes its posts, leads, keywords, profile, runs, usage rows and the encrypted Threads token (ON DELETE CASCADE).
// Invites that were used for it stay as a record but lose the link to the workspace.

import type { Db } from '../db/types';
import { isPlatformAdmin } from './workspaces';

export const DELETE_WORD = 'DELETE';

export type DeleteCheck = { ok: true } | { ok: false; error: string };

/** What must be true before an account may be deleted from the app. Platform admins cannot, so the owner's workspace is never lost by a click. */
export async function canDeleteAccount(db: Db, userId: string): Promise<DeleteCheck> {
  if (await isPlatformAdmin(db, userId)) return { ok: false, error: 'This is a platform admin account. It cannot be deleted from the app.' };
  return { ok: true };
}

export const typedWordMatches = (typed: string | null | undefined): boolean => (typed ?? '').trim() === DELETE_WORD;

export async function memberCount(db: Db, workspaceId: string): Promise<number> {
  const r = await db.query<{ n: string }>('select count(*) as n from workspace_members where workspace_id = $1', [workspaceId]);
  return Number(r.rows[0].n);
}

export type WorkspaceDeleteResult =
  | { ok: true; name: string; membersRemoved: number; loginsRemoved: number }
  | { ok: false; error: string };

/**
 * The app owner deletes a customer workspace together with the logins of its members (a login left behind would only meet a
 * "no workspace" error). Safe order, so a failure can simply be retried:
 *  1. the workspace name must be typed exactly;
 *  2. a workspace with a platform admin in it is refused (the owner's own workspace is never lost by a click);
 *  3. each member's login is removed first (a member who also belongs to another workspace keeps the login and only loses this membership);
 *  4. the workspace itself is deleted last, and only if nobody is in it (ON DELETE CASCADE removes posts, leads, keywords, profile,
 *     runs, usage and the encrypted Threads token).
 * `removeLogin` is passed in so the database part can be tested without Supabase Auth.
 */
export async function deleteWorkspaceAsAdmin(
  db: Db,
  workspaceId: string,
  typedName: string,
  removeLogin: (userId: string) => Promise<{ ok: true } | { ok: false; error: string }>,
): Promise<WorkspaceDeleteResult> {
  const ws = await db.query<{ name: string }>('select name from workspaces where id = $1', [workspaceId]);
  if (!ws.rows[0]) return { ok: false, error: 'That workspace no longer exists.' };
  const name = ws.rows[0].name;
  if (typedName.trim() !== name) return { ok: false, error: 'Type the exact workspace name to confirm. Nothing was deleted.' };

  const members = await db.query<{ user_id: string; is_admin: boolean; others: number }>(
    `select m.user_id,
            exists (select 1 from platform_admins a where a.user_id = m.user_id) as is_admin,
            (select count(*)::int from workspace_members o where o.user_id = m.user_id and o.workspace_id <> m.workspace_id) as others
       from workspace_members m where m.workspace_id = $1`,
    [workspaceId],
  );
  if (members.rows.some((m) => m.is_admin)) return { ok: false, error: 'A platform admin belongs to this workspace, so it cannot be deleted from the app.' };

  let loginsRemoved = 0;
  for (const m of members.rows) {
    if (m.others > 0) {
      await db.query('delete from workspace_members where workspace_id = $1 and user_id = $2', [workspaceId, m.user_id]);
      continue;
    }
    const r = await removeLogin(m.user_id);
    if (!r.ok) return { ok: false, error: `A login could not be removed (${r.error}). The workspace was not deleted. Try again.` };
    loginsRemoved += 1;
  }
  if (!(await deleteWorkspaceIfEmpty(db, workspaceId))) {
    return { ok: false, error: 'Someone joined this workspace while it was being deleted, so it was kept. Try again.' };
  }
  return { ok: true, name, membersRemoved: members.rows.length, loginsRemoved };
}

/** Deletes the workspace when it has no members left. Returns true when it was deleted. */
export async function deleteWorkspaceIfEmpty(db: Db, workspaceId: string): Promise<boolean> {
  const r = await db.query(
    'delete from workspaces w where w.id = $1 and not exists (select 1 from workspace_members m where m.workspace_id = w.id)',
    [workspaceId],
  );
  return r.rowCount > 0;
}
