import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireSession } from '../../../../lib/auth';
import { appUrl, oauthConfig } from '../../../../lib/app/server';
import { buildAuthorizeUrl } from '../../../../lib/threads/oauth';

export const dynamic = 'force-dynamic';

/** Starts the Threads connection: a random state value goes into a short-lived httpOnly cookie (CSRF protection). */
export async function GET() {
  await requireSession(); // redirects to /login when not signed in
  let url: string;
  const state = crypto.randomBytes(24).toString('base64url');
  try {
    url = buildAuthorizeUrl(oauthConfig(), state);
  } catch {
    return NextResponse.redirect(`${appUrl()}/sources?error=${encodeURIComponent('Threads is not configured. Set THREADS_APP_ID and THREADS_APP_SECRET in .env.')}`);
  }
  const res = NextResponse.redirect(url);
  res.cookies.set('threads_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appUrl().startsWith('https://'),
    path: '/api/threads',
    maxAge: 600,
  });
  return res;
}
