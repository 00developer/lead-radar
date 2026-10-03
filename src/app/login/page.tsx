import { redirect } from 'next/navigation';
import { signInErrorKind } from '../../lib/supabase/sign-in-error';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { btnPrimary, ErrorBanner, input } from '../../components/ui';
import { IconCheck, LogoMark } from '../../components/icons';

async function signIn(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One generic message for bad credentials: never reveal whether the email exists. A broken service is reported as such.
  if (error) redirect(`/login?error=${signInErrorKind(error)}`);
  redirect('/');
}

const POINTS = [
  ['Real buyers, not competitors', 'AI reads every public post and separates people who want to hire from people who sell.'],
  ['One inbox, one reply away', 'Each lead comes with the post, the reason, and a reply draft you can edit and copy.'],
  ['You stay in control', 'Nothing is ever sent automatically. You decide who to contact and when.'],
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="app-bg grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden border-r border-(--border) lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-40 blur-3xl" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }} />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full opacity-25 blur-3xl" style={{ background: 'var(--accent-2)' }} />
        <div className="relative flex items-center gap-3">
          <LogoMark size={42} />
          <span className="text-xl font-semibold tracking-tight">Lead Radar</span>
        </div>
        <div className="relative max-w-lg">
          <h1 className="text-5xl font-semibold leading-[1.08] tracking-tight">
            Find people who are <span className="grad-text">ready to hire you</span>.
          </h1>
          <p className="mt-5 text-lg text-(--muted)">Lead Radar watches public Threads posts for people asking for a developer, and turns them into leads you can act on today.</p>
          <ul className="mt-10 space-y-5">
            {POINTS.map(([t, d]) => (
              <li key={t} className="flex gap-3.5">
                <span className="grad-bg mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-white">
                  <IconCheck width={14} height={14} strokeWidth={2.6} />
                </span>
                <div>
                  <p className="font-medium">{t}</p>
                  <p className="text-sm text-(--muted)">{d}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-(--muted)">Public posts only. No accounts are used for scraping, and nothing is posted on your behalf.</p>
      </section>

      {/* Form */}
      <main className="flex items-center justify-center px-5 py-12">
        <div className="rise w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark size={38} />
            <span className="text-lg font-semibold tracking-tight">Lead Radar</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
          <p className="mb-7 mt-1 text-sm text-(--muted)">Sign in to see your leads.</p>
          {error === 'invalid' && <ErrorBanner>Email or password is wrong.</ErrorBanner>}
          {error === 'unavailable' && <ErrorBanner>The sign-in service is not reachable right now. Please try again in a minute.</ErrorBanner>}
          {error === 'no-workspace' && <ErrorBanner>This account has no workspace yet. Ask the owner to add it.</ErrorBanner>}
          <form action={signIn} className="card grid gap-4 p-6">
            <label className="grid gap-1.5 text-sm font-medium">
              Email
              <input className={input} name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Password
              <input className={input} name="password" type="password" autoComplete="current-password" placeholder="••••••••••" required />
            </label>
            <button className={`${btnPrimary} mt-1 w-full py-2.5`} type="submit">
              Sign in
            </button>
          </form>
          <p className="mt-5 text-center text-xs text-(--muted)">Lead Radar is invite-only for now. Open the invite link you received to create your account.</p>
        </div>
      </main>
    </div>
  );
}
