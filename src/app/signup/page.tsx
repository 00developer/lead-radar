import Link from 'next/link';
import { getDb } from '../../lib/app/server';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { findOpenInvite } from '../../lib/phase4/invites';
import { btnPrimary, ErrorBanner, input } from '../../components/ui';
import { LogoMark } from '../../components/icons';
import { signUp } from '../actions/signup';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create your account | Lead Radar' };

const ERRORS: Record<string, string> = {
  input: 'Check the form: a business name, a valid email, and a password of at least 10 characters.',
  terms: 'Please accept the Terms and the Privacy Policy to continue.',
  invite: 'This invite link was already used or has expired. Ask for a new one.',
  email: 'This invite was made for a different email address.',
  create: 'Could not create the account with these details. If you already have an account, sign in instead.',
  failed: 'Something went wrong while setting up your workspace. Please try again.',
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token = '', error } = await searchParams;
  let invite: { id: string; email: string | null } | null = null;
  let unavailable = false;
  try {
    invite = await findOpenInvite(getDb(), token);
  } catch {
    unavailable = true;
  }

  // A browser keeps one login per site. Creating an account here would replace whoever is signed in now.
  let signedInAs: string | null = null;
  try {
    const { data } = await (await createSupabaseServerClient()).auth.getClaims();
    if (data?.claims?.sub) signedInAs = typeof data.claims.email === 'string' ? data.claims.email : 'another account';
  } catch {
    // Not signed in, or the service is down: the form below handles both.
  }

  return (
    <div className="app-bg grid min-h-screen place-items-center px-5 py-12">
      <main className="rise w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark size={38} />
          <span className="text-lg font-semibold tracking-tight">Lead Radar</span>
        </div>
        {unavailable ? (
          <ErrorBanner>The service is not reachable right now. Please try again in a minute.</ErrorBanner>
        ) : !invite ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Invite needed</h1>
            <p className="mt-2 text-sm text-(--muted)">Lead Radar is invite-only for now. This link is not valid, was already used, or has expired. Ask for a new invite link.</p>
            <p className="mt-6 text-sm">
              Already have an account? <Link className="underline" href="/login">Sign in</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
            <p className="mb-6 mt-1 text-sm text-(--muted)">You were invited. This takes a minute.</p>
            {signedInAs && (
              <ErrorBanner>
                This browser is signed in as {signedInAs}. Creating the new account will sign that account out here. To keep both, open this link in a private window.
              </ErrorBanner>
            )}
            {error && ERRORS[error] && <ErrorBanner>{ERRORS[error]}</ErrorBanner>}
            <form action={signUp} className="card grid gap-4 p-6">
              <input type="hidden" name="token" value={token} />
              <label className="grid gap-1.5 text-sm font-medium">
                Business name
                <input className={input} name="name" type="text" autoComplete="organization" minLength={2} maxLength={80} required />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Email
                <input className={input} name="email" type="email" autoComplete="email" defaultValue={invite.email ?? ''} readOnly={Boolean(invite.email)} required />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Password
                <input className={input} name="password" type="password" autoComplete="new-password" minLength={10} maxLength={72} required />
                <span className="text-xs font-normal text-(--muted)">At least 10 characters.</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input className="mt-1" type="checkbox" name="accept" required />
                <span>
                  I agree to the <Link className="underline" href="/terms" target="_blank">Terms</Link> and the <Link className="underline" href="/privacy" target="_blank">Privacy Policy</Link>.
                </span>
              </label>
              <button className={`${btnPrimary} mt-1 w-full py-2.5`} type="submit">
                Create account
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
