import type { ReactNode } from 'react';
import { IconAlert, IconCheck, IconSparkle } from './icons';

// ---- class strings used across pages ------------------------------------------------------------------
// On phones controls get a 44px tap height and inputs use 16px text (smaller text makes iPhones zoom in when a field is tapped).
export const btn =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium sm:min-h-0 border border-(--border) bg-(--surface-2) text-(--fg) transition hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--border))] hover:bg-(--neutral-bg) disabled:opacity-50 disabled:pointer-events-none';
export const btnPrimary =
  'btn-grad inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold sm:min-h-0 disabled:opacity-50 disabled:pointer-events-none';
export const btnDanger =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium sm:min-h-0 border border-[color-mix(in_srgb,var(--bad)_45%,var(--border))] text-(--bad) transition hover:bg-(--bad-bg) disabled:opacity-50';
export const input =
  'w-full min-h-11 rounded-lg border border-(--border) bg-(--surface-2) px-3 py-2 text-base sm:min-h-0 sm:text-sm text-(--fg) placeholder:text-(--muted) transition focus:border-(--accent)';

// ---- layout pieces --------------------------------------------------------------------------------------
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="rise mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-(--muted)">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Card({ title, children, className = '', aside }: { title?: string; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section className={`card rise p-5 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-(--muted)">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES = {
  good: 'bg-(--good-bg) text-(--good)',
  warn: 'bg-(--warn-bg) text-(--warn)',
  bad: 'bg-(--bad-bg) text-(--bad)',
  neutral: 'bg-(--neutral-bg) text-(--muted)',
  accent: 'bg-(--accent-soft) text-(--accent)',
};

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

/** Intent is always shown with a number and a word, never by colour alone. */
export function IntentBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) return <Badge>n/a</Badge>;
  const tone = score >= 80 ? 'good' : score >= 60 ? 'warn' : 'neutral';
  const word = score >= 80 ? 'High' : score >= 60 ? 'Medium' : 'Low';
  return (
    <Badge tone={tone}>
      {score} · {word}
    </Badge>
  );
}

/** Circular gauge for the intent score (0 to 100), with the number in the middle. */
export function IntentRing({ score, size = 52 }: { score: number | null; size?: number }) {
  const v = Math.max(0, Math.min(100, score ?? 0));
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const color = v >= 80 ? 'var(--good)' : v >= 60 ? 'var(--warn)' : 'var(--muted)';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Intent ${score ?? 'unknown'} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--neutral-bg)" strokeWidth="4.5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">{score ?? '–'}</span>
    </div>
  );
}

const AVATAR_HUES = [235, 265, 200, 160, 20, 330, 45];
/** Round avatar with the first letter of the handle and a colour derived from it. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const letter = (name.replace(/^@/, '')[0] ?? '?').toUpperCase();
  const hue = AVATAR_HUES[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_HUES.length];
  return (
    <span
      className="grid shrink-0 place-items-center font-semibold text-white"
      style={{ width: size, height: size, borderRadius: size * 0.34, background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))`, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

export function StatCard({ label, value, hint, icon, tone = 'accent' }: { label: string; value: string | number; hint?: string; icon: ReactNode; tone?: 'accent' | 'good' | 'warn' | 'neutral' }) {
  return (
    <div className="card rise p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-(--muted)">{label}</p>
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${TONES[tone]}`}>{icon}</span>
      </div>
      <p className="text-[2rem] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-2 text-xs text-(--muted)">{hint}</p>}
    </div>
  );
}

const RUN_TONE: Record<string, keyof typeof TONES> = { ok: 'good', partial: 'warn', failed: 'bad', running: 'neutral' };
export function RunStatus({ status }: { status: string }) {
  return <Badge tone={RUN_TONE[status] ?? 'neutral'}>{status}</Badge>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card rise border-dashed p-10 text-center">
      <span className="grad-bg mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl text-white">
        <IconSparkle />
      </span>
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-(--muted)">{children}</div>}
    </div>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rise mb-5 flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--bad)_40%,var(--border))] bg-(--bad-bg) px-4 py-3 text-sm text-(--bad)">
      <IconAlert width={18} height={18} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rise mb-5 flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] bg-(--accent-soft) px-4 py-3 text-sm">
      <IconCheck width={18} height={18} className="mt-0.5 shrink-0 text-(--accent)" />
      <div>{children}</div>
    </div>
  );
}
