'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '../../lib/auth';
import { STATUSES } from '../../lib/dashboard/queries';

const Id = z.string().uuid();

function back(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

export async function setLeadStatus(formData: FormData) {
  const s = await requireSession();
  const id = Id.safeParse(formData.get('id'));
  const status = z.enum(STATUSES).safeParse(formData.get('status'));
  if (!id.success || !status.success) back('/leads', 'Invalid status change.');
  const { error } = await s.supabase.from('leads').update({ status: status.data }).eq('id', id.data).eq('workspace_id', s.workspaceId);
  if (error) back(`/leads/${id.data}`, `Could not change the status: ${error.message}`);
  revalidatePath(`/leads/${id.data}`);
  revalidatePath('/leads');
}

export async function setReviewLabel(formData: FormData) {
  const s = await requireSession();
  const id = Id.safeParse(formData.get('id'));
  const label = z.enum(['genuine', 'not_genuine', 'clear']).safeParse(formData.get('label'));
  if (!id.success || !label.success) back('/leads', 'Invalid label.');
  const { error } = await s.supabase
    .from('leads')
    .update({ review_label: label.data === 'clear' ? null : label.data })
    .eq('id', id.data)
    .eq('workspace_id', s.workspaceId);
  if (error) back(`/leads/${id.data}`, `Could not save the label: ${error.message}`);
  revalidatePath(`/leads/${id.data}`);
  revalidatePath('/');
}

export async function saveLeadNotes(formData: FormData) {
  const s = await requireSession();
  const id = Id.safeParse(formData.get('id'));
  const notes = z.string().max(5000).safeParse(String(formData.get('notes') ?? ''));
  if (!id.success || !notes.success) back('/leads', 'Notes are too long or the lead is invalid.');
  const { error } = await s.supabase.from('leads').update({ notes: notes.data || null }).eq('id', id.data).eq('workspace_id', s.workspaceId);
  if (error) back(`/leads/${id.data}`, `Could not save the notes: ${error.message}`);
  revalidatePath(`/leads/${id.data}`);
  redirect(`/leads/${id.data}?saved=notes`);
}

export async function saveReplyDraft(formData: FormData) {
  const s = await requireSession();
  const id = Id.safeParse(formData.get('id'));
  const text = z.string().max(2000).safeParse(String(formData.get('reply') ?? ''));
  if (!id.success || !text.success) back('/leads', 'The reply is too long or the lead is invalid.');
  const { error } = await s.supabase
    .from('leads')
    .update({ reply_draft_edited: text.data || null })
    .eq('id', id.data)
    .eq('workspace_id', s.workspaceId);
  if (error) back(`/leads/${id.data}`, `Could not save the reply: ${error.message}`);
  revalidatePath(`/leads/${id.data}`);
  redirect(`/leads/${id.data}?saved=reply`);
}

/** Turns a post the AI hid into a lead flagged for review, so a missed buyer is never lost. */
export async function promoteHiddenPost(formData: FormData) {
  const s = await requireSession();
  const postId = Id.safeParse(formData.get('post_id'));
  if (!postId.success) back('/leads?view=hidden', 'Invalid post.');
  const { data: c, error: cErr } = await s.supabase
    .from('classifications')
    .select('id')
    .eq('workspace_id', s.workspaceId)
    .eq('post_id', postId.data)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cErr || !c) back('/leads?view=hidden', 'That post has no classification.');
  const { data: lead, error } = await s.supabase
    .from('leads')
    .upsert({ workspace_id: s.workspaceId, post_id: postId.data, classification_id: c.id, needs_review: true }, { onConflict: 'workspace_id,post_id', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();
  if (error) back('/leads?view=hidden', `Could not create the lead: ${error.message}`);
  revalidatePath('/leads');
  redirect(lead ? `/leads/${lead.id}` : '/leads');
}
