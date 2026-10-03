import 'server-only';
import { notFound } from 'next/navigation';
import { requireSession, type Session } from '../auth';
import { isPlatformAdmin } from '../phase4/workspaces';
import { getDb } from './server';

/** For the Admin page and its actions. Anyone who is not a platform admin gets a plain 404, so the page's existence is not revealed. */
export async function requirePlatformAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!(await isPlatformAdmin(getDb(), s.userId))) notFound();
  return s;
}
