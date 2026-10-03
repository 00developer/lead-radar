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

/** Deletes the workspace when it has no members left. Returns true when it was deleted. */
export async function deleteWorkspaceIfEmpty(db: Db, workspaceId: string): Promise<boolean> {
  const r = await db.query(
    'delete from workspaces w where w.id = $1 and not exists (select 1 from workspace_members m where m.workspace_id = w.id)',
    [workspaceId],
  );
  return r.rowCount > 0;
}
