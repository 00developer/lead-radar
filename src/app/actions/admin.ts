'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requirePlatformAdmin } from '../../lib/app/admin';
import { appUrl, getDb, serverEnv } from '../../lib/app/server';
import { createResendChannel } from '../../lib/alerts/email';
import { buildInviteEmail } from '../../lib/phase4/invite-email';
import { createInvite, MAX_INVITE_DAYS, revokeInvite } from '../../lib/phase4/invites';
import { savePlan } from '../../lib/phase4/workspaces';

function back(kind: 'error' | 'notice', message: string): never {
  redirect(`/admin?${kind}=${encodeURIComponent(message.slice(0, 300))}`);
}

/** Makes a one-time signup link. The link is shown once, on the next page, and cannot be read back later. */
export async function createInviteAction(formData: FormData) {
  const s = await requirePlatformAdmin();
  const parsed = z
    .object({
      email: z.string().trim().email().max(200).or(z.literal('')),
      note: z.string().trim().max(200),
      days: z.coerce.number().int().min(1).max(MAX_INVITE_DAYS),
    })
    .safeParse({ email: formData.get('email') ?? '', note: formData.get('note') ?? '', days: formData.get('days') ?? 7 });
  if (!parsed.success) back('error', `Check the invite: a valid email (or leave it empty) and 1 to ${MAX_INVITE_DAYS} days.`);
  const inv = await createInvite(getDb(), { createdBy: s.userId, email: parsed.data.email || null, note: parsed.data.note || null, days: parsed.data.days });
  revalidatePath('/admin');

  // With an email address the link is also sent by email (when email is set up). The link is always shown too, as a fallback.
  let notice = '';
  if (parsed.data.email) {
    const env = serverEnv();
    if (!env.EMAIL_API_KEY || !env.ALERT_FROM_EMAIL) {
      notice = 'Email sending is not set up yet, so nothing was emailed. Copy the link below and send it yourself.';
    } else {
      const link = `${appUrl()}/signup?token=${encodeURIComponent(inv.token)}`;
      const sent = await createResendChannel({ apiKey: env.EMAIL_API_KEY, from: env.ALERT_FROM_EMAIL }).send(
        buildInviteEmail({ inviteId: inv.id, to: parsed.data.email, link, expiresAt: inv.expiresAt }),
      );
      notice = sent.ok ? `Invite emailed to ${parsed.data.email}.` : `The email could not be sent (${sent.error}). Copy the link below and send it yourself.`;
    }
  }
  redirect(`/admin?token=${encodeURIComponent(inv.token)}${notice ? `&notice=${encodeURIComponent(notice.slice(0, 300))}` : ''}`);
}

export async function revokeInviteAction(formData: FormData) {
  await requirePlatformAdmin();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) back('error', 'Unknown invite.');
  await revokeInvite(getDb(), id.data);
  revalidatePath('/admin');
  back('notice', 'Invite revoked.');
}

/** Sets what one workspace may spend. This is the real limit: runs and AI calls never exceed it. */
export async function savePlanAction(formData: FormData) {
  await requirePlatformAdmin();
  const parsed = z
    .object({
      id: z.string().uuid(),
      results: z.coerce.number().int().min(1).max(1000),
      spend: z.coerce.number().min(0).max(50),
      ai: z.coerce.number().int().min(0).max(1_000_000),
      note: z.string().trim().max(200),
    })
    .safeParse({ id: formData.get('id'), results: formData.get('max_results_cap'), spend: formData.get('max_spend_cap_usd'), ai: formData.get('ai_monthly_cap'), note: formData.get('note') ?? '' });
  if (!parsed.success) back('error', 'Check the numbers: results 1 to 1000, spend $0 to $50, AI calls 0 or more.');
  await savePlan(getDb(), parsed.data.id, {
    allowApify: formData.get('allow_apify') === 'on',
    allowOfficialApi: formData.get('allow_official_api') === 'on',
    maxResultsCap: parsed.data.results,
    maxSpendCapUsd: parsed.data.spend,
    aiMonthlyCap: parsed.data.ai,
    note: parsed.data.note || null,
  });
  revalidatePath('/admin');
  back('notice', 'Plan saved.');
}
