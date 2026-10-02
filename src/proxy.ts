import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (e) {
    // Fail closed: if the session check itself breaks, nobody gets into the private pages, and nothing internal is shown.
    console.error('[proxy] session check failed:', e instanceof Error ? e.message : 'unknown error');
    const path = request.nextUrl.pathname;
    if (path === '/login' || path.startsWith('/api/cron/')) return NextResponse.next();
    const to = request.nextUrl.clone();
    to.pathname = '/login';
    to.search = '?error=unavailable';
    return NextResponse.redirect(to);
  }
}

export const config = {
  // Everything except static files and images.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
