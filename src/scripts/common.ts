// Shared helpers for the CLI scripts. Loads .env from the project root. Never prints secrets.

import 'dotenv/config';
import { createPgDb } from '../lib/db/pg';
import type { Db } from '../lib/db/types';
import { parseEnv, requireValue, type Env } from '../lib/env';
import { createGeminiLlm, type Llm } from '../lib/classifier/llm';

export function loadEnv(): Env {
  return parseEnv(process.env);
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function numArg(args: Record<string, string | boolean>, name: string, fallback: number): number {
  const v = args[name];
  if (v === undefined || v === true) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number.`);
  return n;
}

export function strArg(args: Record<string, string | boolean>, name: string): string | undefined {
  const v = args[name];
  return typeof v === 'string' ? v : undefined;
}

export function openDb(env: Env): Db {
  return createPgDb(requireValue(env.DATABASE_URL, 'DATABASE_URL'), { caPath: env.DATABASE_SSL_CA_PATH, caPem: env.DATABASE_SSL_CA }, env.DATABASE_POOL_MAX);
}

export function openLlm(env: Env): Llm {
  return createGeminiLlm({
    apiKey: requireValue(env.GEMINI_API_KEY, 'GEMINI_API_KEY'),
    model: env.CLASSIFIER_MODEL,
    thinking: env.GEMINI_THINKING,
  });
}

export function run(main: () => Promise<void>): void {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nERROR: ${message}`);
    if (/ENOTFOUND/.test(message) && /supabase\.co/.test(message)) {
      console.error(
        '\nHint: the Supabase direct database address only works over IPv6. If this network has no IPv6 (for example some home Wi-Fi), ' +
          'switch to a network that has it (a phone hotspot usually does), or put the Supabase "Session pooler" connection string in DATABASE_URL ' +
          'and set DATABASE_SSL_CA_PATH to the CA certificate file from the Supabase dashboard. See docs/memory.md.',
      );
    }
    process.exit(1);
  });
}
