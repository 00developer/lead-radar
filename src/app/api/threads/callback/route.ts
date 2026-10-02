import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '../../../../lib/auth';
import { appUrl, getDb, oauthConfig } from '../../../../lib/app/server';
import { safeEqual } from '../../../../lib/crypto';
import { completeConnection } from '../../../../lib/threads/oauth';

export const dynamic = 'force-dynamic';

function done(kind: 'error' | 'connected', message: string) {
  const res = NextResponse.redirect(`${appUrl()}/sources?${kind}=${encodeURIComponent(message)}`);
  res.cookies.delete({ name: 'threads_oauth_state', path: '/api/threads' });
  return res;
}

/** Threads sends the user back here with ?code=...&state=... The state must match the cookie set in /connect. */
export async function GET(request: NextRequest) {
  const s = await requireSession();
  const params = request.nextUrl.searchParams;

  if (params.get('error')) return done('error', 'Threads did not approve the connection. Nothing was saved.');

  const state = params.get('state');
  const cookieState = request.cookies.get('threads_oauth_state')?.value;
  if (!state || !cookieState || !safeEqual(state, cookieState)) return done('error', 'The connection request could not be verified. Please try again.');

  const code = params.get('code');
  if (!code) return done('error', 'Threads did not return a code. Please try again.');

  try {
    const { username } = await completeConnection(getDb(), s.workspaceId, oauthConfig(), code);
    return done('connected', `Connected as @${username}`);
  } catch (e) {
    // The message is redacted by the OAuth module (no secrets, no tokens).
    return done('error', e instanceof Error ? e.message.slice(0, 200) : 'Could not connect the account.');
  }
}
