'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '../../lib/auth';

const Id = z.string().uuid();

function back(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

// ---- keywords -------------------------------------------------------------------------------------

export async function addKeyword(formData: FormData) {
  const s = await requireSession();
  const parsed = z
    .object({
      term: z.string().trim().min(2).max(120),
      language: z.enum(['en', 'hinglish', 'hi']),
      is_negative: z.enum(['true', 'false']),
      service_id: z.string().uuid().or(z.literal('')),
    })
    .safeParse({
      term: formData.get('term'),
      language: formData.get('language') ?? 'en',
      is_negative: formData.get('is_negative') ?? 'false',
      service_id: formData.get('service_id') ?? '',
    });
  if (!parsed.success) back('/keywords', 'Enter a keyword of 2 to 120 characters.');
  const { error } = await s.supabase.from('keywords').insert({
    workspace_id: s.workspaceId,
    term: parsed.data.term,
    language: parsed.data.language,
    is_negative: parsed.data.is_negative === 'true',
    service_id: parsed.data.service_id || null,
  });
  if (error) back('/keywords', error.code === '23505' ? 'That keyword already exists.' : `Could not add the keyword: ${error.message}`);
  revalidatePath('/keywords');
}

export async function toggleKeyword(formData: FormData) {
  const s = await requireSession();
  const id = Id.safeParse(formData.get('id'));
  if (!id.success) back('/keywords', 'Invalid keyword.');
  const enabled = formData.get('enabled') === 'true';
  const { error } = await s.supabase.from('keywords').update({ enabled }).eq('id', id.data).eq('workspace_id', s.workspaceId);
  if (error) back('/keywords', `Could not update the keyword: ${error.message}`);
  revalidatePath('/keywords');
}

export async function deleteKeyword(formData: FormData) {
  const s = await requireSession();
  const id = Id.safeParse(formData.get('id'));
  if (!id.success) back('/keywords', 'Invalid keyword.');
  const { error } = await s.supabase.from('keywords').delete().eq('id', id.data).eq('workspace_id', s.workspaceId);
  if (error) back('/keywords', `Could not delete the keyword: ${error.message}`);
  revalidatePath('/keywords');
}

// ---- settings -------------------------------------------------------------------------------------

const LANGS = ['en', 'hi', 'hinglish', 'other'] as const;

export async function saveSettings(formData: FormData) {
  const s = await requireSession();
  const globalCeiling = Number(process.env.AI_MONTHLY_CEILING ?? 2000) || 2000;
  const parsed = z
    .object({
      lead: z.coerce.number().int().min(0).max(100),
      alert: z.coerce.number().int().min(0).max(100),
      age: z.coerce.number().int().min(1).max(365),
      ceiling: z.coerce.number().int().min(0).max(1_000_000),
      email: z.string().trim().email().max(200).or(z.literal('')),
    })
    .safeParse({
      lead: formData.get('lead_intent_threshold'),
      alert: formData.get('alert_intent_threshold'),
      age: formData.get('max_post_age_days'),
      ceiling: formData.get('ai_monthly_ceiling'),
      email: formData.get('alert_email') ?? '',
    });
  if (!parsed.success) back('/settings', 'Check the numbers: thresholds 0 to 100, age 1 to 365 days, and a valid email.');
  const languages = LANGS.filter((l) => formData.getAll('languages').includes(l));
  if (languages.length === 0) back('/settings', 'Pick at least one language.');

  const { error } = await s.supabase
    .from('workspace_settings')
    .update({
      lead_intent_threshold: parsed.data.lead,
      alert_intent_threshold: parsed.data.alert,
      max_post_age_days: parsed.data.age,
      // The workspace setting can never exceed the global safety ceiling from the environment.
      ai_monthly_ceiling: Math.min(parsed.data.ceiling, globalCeiling),
      alert_email: parsed.data.email || null,
      allowed_languages: languages,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', s.workspaceId);
  if (error) back('/settings', `Could not save the settings: ${error.message}`);
  revalidatePath('/settings');
  redirect('/settings?saved=1');
}

export async function saveService(formData: FormData) {
  const s = await requireSession();
  const id = Id.safeParse(formData.get('id'));
  const parsed = z
    .object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(300) })
    .safeParse({ name: formData.get('name'), description: formData.get('description') ?? '' });
  if (!id.success || !parsed.success) back('/settings', 'A service needs a name of 2 to 80 characters.');
  const { error } = await s.supabase
    .from('workspace_services')
    .update({ name: parsed.data.name, description: parsed.data.description || null, enabled: formData.get('enabled') === 'on' })
    .eq('id', id.data)
    .eq('workspace_id', s.workspaceId);
  if (error) back('/settings', `Could not save the service: ${error.message}`);
  revalidatePath('/settings');
}

export async function addService(formData: FormData) {
  const s = await requireSession();
  const parsed = z
    .object({
      slug: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,40}$/).refine((v) => v !== 'other'),
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(300),
    })
    .safeParse({ slug: formData.get('slug'), name: formData.get('name'), description: formData.get('description') ?? '' });
  if (!parsed.success) back('/settings', 'Slug: lowercase letters, digits and underscores (not "other"). Name: 2 to 80 characters.');
  const { error } = await s.supabase
    .from('workspace_services')
    .insert({ workspace_id: s.workspaceId, slug: parsed.data.slug, name: parsed.data.name, description: parsed.data.description || null });
  if (error) back('/settings', error.code === '23505' ? 'A service with that slug already exists.' : `Could not add the service: ${error.message}`);
  revalidatePath('/settings');
}

// ---- sources --------------------------------------------------------------------------------------

export async function saveSource(formData: FormData) {
  const s = await requireSession();
  const parsed = z
    .object({
      source: z.enum(['apify_threads', 'threads_api']),
      max_results: z.coerce.number().int().min(1).max(1000),
      max_spend_usd: z.coerce.number().min(0).max(50),
    })
    .safeParse({ source: formData.get('source'), max_results: formData.get('max_results'), max_spend_usd: formData.get('max_spend_usd') });
  if (!parsed.success) back('/sources', 'Max results 1 to 1000, max spend $0 to $50.');
  const { error } = await s.supabase
    .from('workspace_sources')
    .update({
      enabled: formData.get('enabled') === 'on',
      max_results: parsed.data.max_results,
      max_spend_usd: parsed.data.max_spend_usd,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', s.workspaceId)
    .eq('source', parsed.data.source);
  if (error) back('/sources', `Could not save the source: ${error.message}`);
  revalidatePath('/sources');
  redirect('/sources?saved=1');
}
