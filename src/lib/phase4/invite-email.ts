// The email that carries an invite link. Plain and short. The link is the only secret in it, and it works once.

import type { AlertMessage } from '../alerts/channel';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildInviteEmail(v: { inviteId: string; to: string; link: string; expiresAt: Date }): AlertMessage {
  const until = v.expiresAt.toUTCString().replace(/ GMT$/, ' UTC');
  const text = [
    'You have been invited to Lead Radar.',
    '',
    'Lead Radar finds public Threads posts from people who are looking for what your business sells, and shows them as leads you can contact yourself.',
    '',
    `Create your account here: ${v.link}`,
    '',
    `The link works once and expires on ${until}. If you did not expect this email, you can ignore it.`,
  ].join('\n');
  const link = escapeHtml(v.link);
  const html = [
    '<p>You have been invited to <strong>Lead Radar</strong>.</p>',
    '<p>Lead Radar finds public Threads posts from people who are looking for what your business sells, and shows them as leads you can contact yourself.</p>',
    `<p><a href="${link}">Create your account</a></p>`,
    `<p style="color:#666;font-size:13px">The link works once and expires on ${escapeHtml(until)}. If you did not expect this email, you can ignore it.</p>`,
  ].join('');
  return { key: `invite-${v.inviteId}`, to: v.to, subject: 'You are invited to Lead Radar', text, html };
}
