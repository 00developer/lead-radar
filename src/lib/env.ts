// Zod-validated environment. Secrets are read only from environment variables (loaded from .env by the scripts).
// Never log the values from this module.

import { z } from 'zod';

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(blankToUndefined, z.string().min(1).optional());
const positiveNumber = (fallback: number) => z.preprocess(blankToUndefined, z.coerce.number().positive().default(fallback));
const positiveInt = (fallback: number) => z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(fallback));

const schema = z.object({
  DATABASE_URL: optionalString,
  DATABASE_SSL_CA_PATH: optionalString,
  /** The CA certificate itself (PEM text), for hosts without files such as Vercel. Line breaks may be written as \n. */
  DATABASE_SSL_CA: optionalString,
  /** Connections per server instance. Keep it small on serverless (1 or 2) so the database pooler is not exhausted. */
  DATABASE_POOL_MAX: positiveInt(4),

  LLM_PROVIDER: z.preprocess(blankToUndefined, z.enum(['gemini']).default('gemini')),
  GEMINI_API_KEY: optionalString,
  CLASSIFIER_MODEL: z.preprocess(blankToUndefined, z.string().min(1).default('gemini-3.8-flash')),
  GEMINI_THINKING: z.preprocess(blankToUndefined, z.enum(['minimal', 'low', 'medium', 'high']).optional()),

  APIFY_TOKEN: optionalString,
  APIFY_ACTOR_ID: z.preprocess(blankToUndefined, z.string().min(1).default('webdata_labs/threads-scraper')),
  APIFY_PRICE_PER_1K_USD: positiveNumber(3),

  THREADS_ACCESS_TOKEN: optionalString,
  THREADS_APP_ID: optionalString,
  THREADS_APP_SECRET: optionalString,
  THREADS_REDIRECT_URI: optionalString,

  // Phase 2: dashboard, alerts, connection, scheduler
  NEXT_PUBLIC_SUPABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  APP_URL: optionalString,
  CRON_SECRET: optionalString,
  ENCRYPTION_KEY: optionalString,
  EMAIL_API_KEY: optionalString,
  ALERT_FROM_EMAIL: optionalString,
  OWNER_EMAIL: optionalString,
  OWNER_PASSWORD: optionalString,

  COLLECT_MAX_RESULTS: positiveInt(100),
  COLLECT_MAX_SPEND_USD: positiveNumber(0.5),
  CLASSIFY_MAX_CALLS_PER_RUN: positiveInt(100),
  AI_MONTHLY_CEILING: positiveInt(2000),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Report which variables are wrong, never their values.
    const names = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment variables: ${names}. See .env.example.`);
  }
  return result.data;
}

/** Returns the value or throws a clear message that names the variable (never its value). */
export function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not set. Add it to .env (see .env.example).`);
  return value;
}
