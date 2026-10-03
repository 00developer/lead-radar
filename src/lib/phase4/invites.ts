// One-time invite links for the invite-only signup. The link carries a random token; only its SHA-256 hash is stored,
// so a database leak does not leak working links. A token can be used once, expires, and can be revoked.

import crypto from 'node:crypto';
import type { Db } from '../db/types';

export const DEFAULT_INVITE_DAYS = 7;
export const MAX_INVITE_DAYS = 30;

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export type InviteRow = {
  id: string;
  email: string | null;
  note: string | null;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  used_workspace_id: string | null;
};

export type InviteStatus = 'open' | 'used' | 'expired' | 'revoked';

export function inviteStatus(i: Pick<InviteRow, 'used_at' | 'revoked_at' | 'expires_at'>, now: Date = new Date()): InviteStatus {
  if (i.revoked_at) return 'revoked';
  if (i.used_at) return 'used';
  return new Date(i.expires_at).getTime() <= now.getTime() ? 'expired' : 'open';
}

/** Creates an invite and returns the raw token. It is shown once and cannot be read back later. */
export async function createInvite(
  db: Db,
  v: { createdBy: string | null; email?: string | null; note?: string | null; days?: number; now?: Date },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const days = Math.min(Math.max(Math.round(v.days ?? DEFAULT_INVITE_DAYS), 1), MAX_INVITE_DAYS);
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date((v.now ?? new Date()).getTime() + days * 86_400_000);
  const email = v.email?.trim().toLowerCase() || null;
  const r = await db.query<{ id: string }>(
    'insert into invites (token_hash, email, note, created_by, expires_at) values ($1,$2,$3,$4,$5) returning id',
    [hashToken(token), email, v.note?.trim().slice(0, 200) || null, v.createdBy, expiresAt.toISOString()],
  );
  return { id: r.rows[0].id, token, expiresAt };
}

/** Looks an invite up without using it (to show the signup form). Returns null for anything that cannot be used. */
export async function findOpenInvite(db: Db, token: string, now: Date = new Date()): Promise<{ id: string; email: string | null } | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const r = await db.query<{ id: string; email: string | null }>(
    'select id, email from invites where token_hash = $1 and used_at is null and revoked_at is null and expires_at > $2',
    [hashToken(token), now.toISOString()],
  );
  return r.rows[0] ?? null;
}

/** Atomically claims an open invite. Two people using the same link at once: exactly one wins. */
export async function claimInvite(db: Db, token: string, now: Date = new Date()): Promise<{ id: string; email: string | null } | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const r = await db.query<{ id: string; email: string | null }>(
    `update invites set used_at = $2 where token_hash = $1 and used_at is null and revoked_at is null and expires_at > $2 returning id, email`,
    [hashToken(token), now.toISOString()],
  );
  return r.rows[0] ?? null;
}

/** Gives a claimed invite back (signup failed after the claim, so the person can try again with the same link). */
export async function releaseInvite(db: Db, inviteId: string): Promise<void> {
  await db.query('update invites set used_at = null, used_workspace_id = null where id = $1', [inviteId]);
}

export async function attachInviteToWorkspace(db: Db, inviteId: string, workspaceId: string): Promise<void> {
  await db.query('update invites set used_workspace_id = $2 where id = $1', [inviteId, workspaceId]);
}

export async function revokeInvite(db: Db, inviteId: string): Promise<boolean> {
  const r = await db.query('update invites set revoked_at = now() where id = $1 and used_at is null and revoked_at is null', [inviteId]);
  return r.rowCount > 0;
}

export async function listInvites(db: Db, limit = 50): Promise<InviteRow[]> {
  const r = await db.query<InviteRow>(
    'select id, email, note, created_at, expires_at, used_at, revoked_at, used_workspace_id from invites order by created_at desc limit $1',
    [limit],
  );
  return r.rows;
}
