// AES-256-GCM helpers for stored Threads access tokens (docs/architecture.md section 17).
// The key comes from ENCRYPTION_KEY (32 random bytes, base64). Changing the key makes stored tokens unreadable:
// users then have to reconnect. Format: v1:<iv>:<auth tag>:<ciphertext>, each part base64.

import crypto from 'node:crypto';

const VERSION = 'v1';

export function parseKey(base64: string | undefined): Buffer {
  if (!base64) throw new Error('ENCRYPTION_KEY is not set. Generate one (see docs/credentials.md) and put it in .env.');
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes encoded as base64.');
  return key;
}

export function encryptSecret(plain: string, keyBase64: string | undefined): string {
  const key = parseKey(keyBase64);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(payload: string, keyBase64: string | undefined): string {
  const key = parseKey(keyBase64);
  const [version, iv, tag, data] = payload.split(':');
  if (version !== VERSION || !iv || !tag || !data) throw new Error('Stored secret has an unknown format.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key or tampered data. Never include the payload in the message.
    throw new Error('Could not decrypt the stored secret (wrong ENCRYPTION_KEY or corrupted data). The account must be reconnected.');
  }
}

/** Constant-time string comparison for state values and cron secrets. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
