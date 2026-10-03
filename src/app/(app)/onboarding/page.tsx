import Link from 'next/link';
import { requireSession } from '../../../lib/auth';
import { getDb } from '../../../lib/app/server';
import { getOnboardingSteps } from '../../../lib/phase4/onboarding';
import { Badge, btn, btnPrimary, Card, PageHeader } from '../../../components/ui';
import { IconCheck } from '../../../components/icons';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const s = await requireSession();
  const steps = await getOnboardingSteps(getDb(), s.workspaceId);
  const required = steps.filter((x) => !x.optional);
  const left = required.filter((x) => !x.done).length;
  const next = steps.find((x) => !x.done && !x.optional);

  return (
    <>
      <PageHeader
        title="Set up your workspace"
        subtitle={left === 0 ? 'All required steps are done. Leads will appear in Leads as runs finish.' : `${left} step${left === 1 ? '' : 's'} left before leads can appear.`}
      >
        {next && (
          <Link className={btnPrimary} href={next.href}>
            {next.cta}
          </Link>
        )}
      </PageHeader>
      <div className="grid gap-3">
        {steps.map((step, i) => (
          <Card key={step.key}>
            <div className="flex flex-wrap items-center gap-4">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${step.done ? 'grad-bg text-white' : 'border border-(--border) text-(--muted)'}`}>
                {step.done ? <IconCheck width={16} height={16} strokeWidth={2.6} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {step.title} {step.optional && <Badge>optional</Badge>}
                </p>
                <p className="text-sm text-(--muted)">{step.detail}</p>
              </div>
              <Link className={btn} href={step.href}>
                {step.done ? 'View' : step.cta}
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
