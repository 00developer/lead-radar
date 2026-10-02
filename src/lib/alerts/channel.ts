// Alert channel abstraction (docs/prd.md FR-N3): Telegram and WhatsApp can be added later without touching the pipeline.

export type AlertMessage = {
  /** Used to make the send idempotent at the provider (one message per lead). */
  key: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type SendResult = { ok: true } | { ok: false; error: string };

export interface AlertChannel {
  id: 'email' | 'telegram' | 'whatsapp';
  send(message: AlertMessage): Promise<SendResult>;
}
