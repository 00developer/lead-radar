'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '../../lib/auth';
import { getDb, serverEnv, appUrl } from '../../lib/app/server';
import { realLlm } from '../../lib/app/deps';
import { createNodeTransport } from '../../lib/profile/transport';
import { workspaceAiCeiling } from '../../lib/phase4/workspaces';
import { analyzePastedText, scanWebsiteForProfile, suggestKeywordsForProfile } from '../../lib/profile/run';
import {
  acceptPendingScan, addManualOffering, approveSuggestion, confirmProfile, deleteOffering, discardPendingScan, ensureProfile, rejectSuggestion, updateOffering,
} from '../../lib/profile/store';

const Id = z.string().uuid();

function go(kind: 'error' | 'notice', message: string): never {
  redirect(`/profile?${kind}=${encodeURIComponent(message.slice(0, 400))}`);
}

/** Scans the website. The address is checked and fetched by the safe fetcher (private addresses are refused). */
export async function scanWebsite(formData: FormData) {
  const s = await requireSession();
  const url = z.string().trim().min(3).max(2000).safeParse(formData.get('url'));
  if (!url.success) go('error', 'Enter your website address.');
  let r;
  try {
    r = await scanWebsiteForProfile(getDb(), s.workspaceId, url.data, {
      transport: createNodeTransport(), llm: realLlm(), appUrl: appUrl(), ceiling: await workspaceAiCeiling(getDb(), s.workspaceId, Math.min(serverEnv().AI_MONTHLY_CEILING, 100_000)),
    });
  } catch (e) {
    go('error', e instanceof Error ? e.message : 'The scan failed.');
  }
  revalidatePath('/profile');
  if (!r.ok) go('error', r.error);
  const notes = r.notes.length ? ` ${r.notes.join(' ')}` : '';
  go('notice', r.status === 'pending' ? `Re-scan finished: ${r.offerings} items found in ${r.pages} pages. Review the changes below.${notes}` : `Scan finished: ${r.offerings} products and services found in ${r.pages} pages. Please review the list, edit it, and confirm.${notes}`);
}

/** Analyses text the user pasted (works for every site, including ones that hide their text behind JavaScript). */
export async function analyzeText(formData: FormData) {
  const s = await requireSession();
  const text = z.string().max(60_000).safeParse(formData.get('text') ?? '');
  if (!text.success) go('error', 'That text is too long.');
  let r;
  try {
    r = await analyzePastedText(getDb(), s.workspaceId, text.data, { llm: realLlm(), ceiling: await workspaceAiCeiling(getDb(), s.workspaceId, Math.min(serverEnv().AI_MONTHLY_CEILING, 100_000)) });
  } catch (e) {
    go('error', e instanceof Error ? e.message : 'The analysis failed.');
  }
  revalidatePath('/profile');
  if (!r.ok) go('error', r.error);
  go('notice', r.status === 'pending' ? `Analysis finished: ${r.offerings} items found. Review the changes below.` : `Analysis finished: ${r.offerings} products and services found. Please review the list, edit it, and confirm.`);
}

export async function startManually(formData: FormData) {
  const s = await requireSession();
  const url = z.string().trim().max(2000).safeParse(formData.get('url') ?? '');
  await ensureProfile(getDb(), s.workspaceId, (url.success && url.data) || '(added by hand)');
  revalidatePath('/profile');
  redirect('/profile');
}

const Kind = z.enum(['product', 'service']);

export async function saveOffering(formData: FormData) {
  const s = await requireSession();
  const p = z
    .object({ id: Id, name: z.string().trim().min(2).max(80), description: z.string().trim().max(240), kind: Kind, service: Id.or(z.literal('')), portfolioUrl: z.string().trim().max(2000).optional() })
    .safeParse({ id: formData.get('id'), name: formData.get('name'), description: formData.get('description') ?? '', kind: formData.get('kind'), service: formData.get('service') ?? '', portfolioUrl: formData.get('portfolioUrl') ?? '' });
  if (!p.success) go('error', 'A product or service needs a name of 2 to 80 characters.');
  await updateOffering(getDb(), s.workspaceId, p.data.id, { name: p.data.name, description: p.data.description, kind: p.data.kind, serviceId: p.data.service || null, portfolioUrl: p.data.portfolioUrl || null });
  revalidatePath('/profile');
  go('notice', 'Saved. Confirm the list again so the AI uses the change.');
}

export async function removeOffering(formData: FormData) {
  const s = await requireSession();
  const id = Id.safeParse(formData.get('id'));
  if (!id.success) go('error', 'Invalid item.');
  await deleteOffering(getDb(), s.workspaceId, id.data);
  revalidatePath('/profile');
  redirect('/profile');
}

export async function addOffering(formData: FormData) {
  const s = await requireSession();
  const p = z
    .object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(240), kind: Kind, portfolioUrl: z.string().trim().max(2000).optional() })
    .safeParse({ name: formData.get('name'), description: formData.get('description') ?? '', kind: formData.get('kind'), portfolioUrl: formData.get('portfolioUrl') ?? '' });
  if (!p.success) go('error', 'A product or service needs a name of 2 to 80 characters.');
  await addManualOffering(getDb(), s.workspaceId, p.data);
  revalidatePath('/profile');
  redirect('/profile');
}

export async function confirmList(formData: FormData) {
  const s = await requireSession();
  const summary = z.string().trim().max(800).safeParse(formData.get('summary') ?? '');
  if (!summary.success) go('error', 'The summary is too long (800 characters at most).');
  try {
    const r = await confirmProfile(getDb(), s.workspaceId, summary.data);
    revalidatePath('/profile');
    go('notice', `Confirmed. The AI now uses your list (${r.confirmed} newly confirmed). New leads will show which offering they match.`);
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e; // Next.js redirect
    go('error', e instanceof Error ? e.message : 'Could not confirm.');
  }
}

export async function acceptRescan() {
  const s = await requireSession();
  const r = await acceptPendingScan(getDb(), s.workspaceId);
  revalidatePath('/profile');
  go('notice', `${r.added} new item(s) were added as drafts. Confirm the list to use them.`);
}

export async function discardRescan() {
  const s = await requireSession();
  await discardPendingScan(getDb(), s.workspaceId);
  revalidatePath('/profile');
  redirect('/profile');
}

export async function suggestKeywordsAction() {
  const s = await requireSession();
  let r;
  try {
    r = await suggestKeywordsForProfile(getDb(), s.workspaceId, { llm: realLlm(), ceiling: await workspaceAiCeiling(getDb(), s.workspaceId, Math.min(serverEnv().AI_MONTHLY_CEILING, 100_000)) });
  } catch (e) {
    go('error', e instanceof Error ? e.message : 'Could not suggest keywords.');
  }
  revalidatePath('/profile');
  if (!r.ok) go('error', r.error);
  go('notice', r.added === 0 ? 'No new keyword ideas this time.' : `${r.added} keyword suggestion(s) added. Approve the ones you want.`);
}

export async function decideSuggestion(formData: FormData) {
  const s = await requireSession();
  const id = Id.safeParse(formData.get('id'));
  if (!id.success) go('error', 'Invalid suggestion.');
  if (formData.get('decision') === 'approve') await approveSuggestion(getDb(), s.workspaceId, id.data);
  else await rejectSuggestion(getDb(), s.workspaceId, id.data);
  revalidatePath('/profile');
  revalidatePath('/keywords');
  redirect('/profile');
}
