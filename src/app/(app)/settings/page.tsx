import { requireSession } from '../../../lib/auth';
import { getAiUsageThisMonth, getSettings, listServices } from '../../../lib/dashboard/queries';
import { btn, btnDanger, btnPrimary, Card, ErrorBanner, input, Notice, PageHeader } from '../../../components/ui';
import { deleteMyAccount } from '../../actions/account';
import { addService, saveService, saveSettings } from '../../actions/workspace';
import { SubmitButton } from '../../../components/submit-button';

export const dynamic = 'force-dynamic';

const LANGS = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'Hindi' },
  { id: 'hinglish', label: 'Hinglish' },
  { id: 'other', label: 'Other languages' },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const p = await searchParams;
  const s = await requireSession();
  const [settings, services, used] = await Promise.all([getSettings(s), listServices(s), getAiUsageThisMonth(s)]);
  if (!settings) return <ErrorBanner>This workspace has no settings row. Run "npm run seed".</ErrorBanner>;

  return (
    <>
      <PageHeader title="Settings" subtitle="Thresholds, languages, alert email and the services the AI looks for." />
      {p.error && <ErrorBanner>{p.error}</ErrorBanner>}
      {p.saved && <Notice>Saved.</Notice>}

      <Card title="Thresholds, filters and alerts" className="mb-6">
        <form action={saveSettings} className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Lead threshold (intent 0 to 100)
            <input className={input} type="number" name="lead_intent_threshold" min={0} max={100} defaultValue={settings.lead_intent_threshold} />
            <span className="text-xs text-(--muted)">A buyer at or above this becomes a lead.</span>
          </label>
          <label className="grid gap-1 text-sm">
            Alert threshold (intent 0 to 100)
            <input className={input} type="number" name="alert_intent_threshold" min={0} max={100} defaultValue={settings.alert_intent_threshold} />
            <span className="text-xs text-(--muted)">Leads at or above this send one email.</span>
          </label>
          <label className="grid gap-1 text-sm">
            Ignore posts older than (days)
            <input className={input} type="number" name="max_post_age_days" min={1} max={365} defaultValue={settings.max_post_age_days} />
          </label>
          <label className="grid gap-1 text-sm">
            Monthly AI call limit
            <input className={input} type="number" name="ai_monthly_ceiling" min={0} defaultValue={settings.ai_monthly_ceiling} />
            <span className="text-xs text-(--muted)">Used this month: {used}. Cannot exceed the global safety limit.</span>
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">
            Alert email address
            <input className={input} type="email" name="alert_email" defaultValue={settings.alert_email ?? ''} placeholder="you@example.com" />
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="flex items-center gap-2">
              <input type="checkbox" name="auto_run_enabled" defaultChecked={settings.auto_run_enabled} />
              Enable automatic daily runs
            </span>
            <span className="text-xs text-(--muted)">If checked, the background cron will automatically search for new leads every day.</span>
          </label>
          <fieldset className="md:col-span-2">
            <legend className="mb-1 text-sm">Languages that can become leads</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {LANGS.map((l) => (
                <label key={l.id} className="flex items-center gap-2">
                  <input type="checkbox" name="languages" value={l.id} defaultChecked={(settings.allowed_languages as string[]).includes(l.id)} />
                  {l.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-(--muted)">Posts in other languages are kept but shown under "Hidden by AI".</p>
          </fieldset>
          <div className="md:col-span-2">
            <SubmitButton className={btnPrimary} pendingLabel="Saving…">
              Save settings
            </SubmitButton>
          </div>
        </form>
      </Card>

      <Card title="Services">
        <p className="mb-3 text-sm text-(--muted)">The AI gets this list. A post that asks for something else is marked "other".</p>
        <ul className="grid gap-3">
          {services.map((sv) => (
            <li key={sv.id} className="border-t border-(--border) pt-3 first:border-t-0 first:pt-0">
              <form action={saveService} className="grid gap-2 md:grid-cols-6">
                <input type="hidden" name="id" value={sv.id} />
                <code className="self-center text-xs text-(--muted)">{sv.slug}</code>
                <input className={`${input} md:col-span-2`} name="name" defaultValue={sv.name} aria-label={`Name of ${sv.slug}`} />
                <input className={`${input} md:col-span-2`} name="description" defaultValue={sv.description ?? ''} aria-label={`Description of ${sv.slug}`} />
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-sm">
                    <input type="checkbox" name="enabled" defaultChecked={sv.enabled} /> on
                  </label>
                  <SubmitButton className={btn} pendingLabel="Saving…">
                    Save
                  </SubmitButton>
                </div>
              </form>
            </li>
          ))}
        </ul>
        <form action={addService} className="mt-4 grid gap-2 border-t border-(--border) pt-4 md:grid-cols-6">
          <input className={input} name="slug" placeholder="slug_like_this" aria-label="New service slug" required />
          <input className={`${input} md:col-span-2`} name="name" placeholder="Service name" aria-label="New service name" required />
          <input className={`${input} md:col-span-2`} name="description" placeholder="Short description for the AI" aria-label="New service description" />
          <SubmitButton className={btn} pendingLabel="Adding…">
            Add service
          </SubmitButton>
        </form>
      </Card>

      <div id="delete-account" className="mt-6">
        <Card title="Delete my account">
          <p className="mb-3 text-sm text-(--muted)">
            This permanently deletes your login and your workspace: leads, posts, keywords, business profile, notes and the connected Threads token. It cannot be undone.
          </p>
          <form action={deleteMyAccount} autoComplete="off" className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              Your password
              <input className={`${input} w-60`} type="password" name="password" autoComplete="current-password" required />
            </label>
            <label className="grid gap-1 text-sm">
              Type DELETE to confirm
              <input className={`${input} w-48`} type="text" name="confirm" autoComplete="off" required />
            </label>
            <SubmitButton className={btnDanger} pendingLabel="Deleting your account…" note="Please wait. You are signed out when it is done.">
              Delete my account
            </SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
