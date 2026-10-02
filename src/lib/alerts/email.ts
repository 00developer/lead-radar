// Email alerts through Resend (decision D-15). Verified against Resend's docs on 2026-09-30:
// POST https://api.resend.com/emails, "Authorization: Bearer <key>", JSON body from / to / subject / html / text,
// optional Idempotency-Key header (max 256 characters, kept 24 hours), success body { "id": "..." }.

import type { AlertChannel, AlertMessage, SendResult } from './channel';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export function createResendChannel(opts: { apiKey: string; from: string; fetchFn?: FetchLike }): AlertChannel {
  const doFetch: FetchLike = opts.fetchFn ?? ((url, init) => fetch(url, init));
  return {
    id: 'email',
    async send(m: AlertMessage): Promise<SendResult> {
      try {
        const res = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': m.key.slice(0, 256),
          },
          body: JSON.stringify({ from: opts.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        });
        if (res.ok) return { ok: true };
        let detail = '';
        try {
          const body = (await res.json()) as { message?: string; name?: string };
          detail = body.message ?? body.name ?? '';
        } catch {
          // ignore body parse errors
        }
        return { ok: false, error: `Email provider returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`.slice(0, 300) };
      } catch (err) {
        const msg = err instanceof Error ? err.message.replaceAll(opts.apiKey, '[key]') : 'request failed';
        return { ok: false, error: `Email request failed: ${msg}`.slice(0, 300) };
      }
    },
  };
}
