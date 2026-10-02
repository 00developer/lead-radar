// Builds the alert email (docs/design.md section 9): plain, no images, text and HTML versions, everything escaped.

export type AlertLead = {
  id: string;
  service: string | null;
  intent_score: number | null;
  author_handle: string;
  reason: string | null;
  text: string;
  post_url: string;
  reply_draft: string | null;
  needs_review: boolean;
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Only http(s) links are put into href attributes. */
function safeUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? u : '#';
}

export function buildLeadEmail(lead: AlertLead, appUrl: string): { subject: string; text: string; html: string } {
  const subject = `New lead: ${lead.service ?? 'other'} · intent ${lead.intent_score ?? '?'} · @${lead.author_handle}`.replace(/[\r\n]+/g, ' ');
  const postText = clip(lead.text.replace(/\r/g, ''), 500);
  const leadLink = `${appUrl.replace(/\/$/, '')}/leads/${lead.id}`;
  const review = lead.needs_review ? 'The AI was unsure about this one. Please check it.\n\n' : '';

  const text = [
    review + (lead.reason ? `Why: ${lead.reason}\n` : ''),
    `Post by @${lead.author_handle}:`,
    postText,
    '',
    `Original post: ${lead.post_url}`,
    `Open in Lead Radar: ${leadLink}`,
    lead.reply_draft ? `\nReply draft (not sent):\n${lead.reply_draft}` : '',
    '\nThis tool never contacts anyone. You send the reply yourself.',
  ].join('\n');

  const html = `<div style="font-family:system-ui,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1a1f26;max-width:560px">
${lead.needs_review ? '<p><strong>The AI was unsure about this one. Please check it.</strong></p>' : ''}
${lead.reason ? `<p><strong>Why:</strong> ${escapeHtml(lead.reason)}</p>` : ''}
<p>Post by <strong>@${escapeHtml(lead.author_handle)}</strong>:</p>
<blockquote style="margin:0;padding:8px 12px;border-left:3px solid #c5ccd6;white-space:pre-wrap">${escapeHtml(postText)}</blockquote>
<p><a href="${escapeHtml(safeUrl(lead.post_url))}">Open original post</a></p>
<p><a href="${escapeHtml(safeUrl(leadLink))}" style="display:inline-block;padding:8px 14px;background:#2456d6;color:#ffffff;text-decoration:none;border-radius:6px">Open in Lead Radar</a></p>
${lead.reply_draft ? `<p><strong>Reply draft (not sent):</strong></p><p style="white-space:pre-wrap">${escapeHtml(lead.reply_draft)}</p>` : ''}
<p style="color:#5d6673;font-size:13px">This tool never contacts anyone. You send the reply yourself.</p>
</div>`;

  return { subject, text, html };
}
