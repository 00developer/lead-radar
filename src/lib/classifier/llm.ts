// One wrapper for every LLM call (docs/architecture.md), so the provider can be changed without touching the classifier.
// Default provider is Gemini (decision D-31).
//
// Decision D-35 lesson from Phase 0: the free Gemini tier allows very few requests, and a silent retry loop hid that for
// 15 minutes. Here every retry is logged, retries are short, and a quota error stops the whole run with a clear message.

import { GoogleGenAI, ThinkingLevel } from '@google/genai';

export type LlmResult = { text: string; inputTokens: number; outputTokens: number };

export interface Llm {
  provider: string;
  model: string;
  complete(system: string, user: string): Promise<LlmResult>;
}

/** The provider says we are over the quota. Retrying does not help, so callers should stop the run. */
export class LlmQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmQuotaError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryDelaySeconds(message: string): number | null {
  const m = /retry in ([\d.]+)s/i.exec(message);
  return m ? Number(m[1]) : null;
}

function short(message: string): string {
  return message.replace(/\s+/g, ' ').slice(0, 300);
}

/**
 * 429 (quota): wait at most twice, and only if the provider asks for 60 seconds or less. Then throw LlmQuotaError.
 * 503 / overloaded: retry up to 3 times with growing waits. Everything else is thrown at once.
 * Every retry is logged. No secrets appear in these messages.
 */
export async function withRetry<T>(fn: () => Promise<T>, wait: (ms: number) => Promise<void> = sleep): Promise<T> {
  let quotaTries = 0;
  let busyTries = 0;
  const busyWaits = [5_000, 15_000, 30_000];
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof LlmQuotaError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
        const delay = retryDelaySeconds(msg);
        if (quotaTries >= 2 || delay === null || delay > 60) {
          throw new LlmQuotaError(`LLM quota exceeded: ${short(msg)}`);
        }
        quotaTries += 1;
        console.warn(`[llm] rate limited (429). Waiting ${Math.ceil(delay)}s, retry ${quotaTries} of 2. ${short(msg)}`);
        await wait((delay + 1) * 1000);
        continue;
      }
      if (/503|UNAVAILABLE|overloaded/i.test(msg) && busyTries < busyWaits.length) {
        console.warn(`[llm] provider busy (503). Waiting ${busyWaits[busyTries] / 1000}s, retry ${busyTries + 1} of ${busyWaits.length}.`);
        await wait(busyWaits[busyTries]);
        busyTries += 1;
        continue;
      }
      throw e;
    }
  }
}

function thinkingLevel(name: string | undefined): ThinkingLevel | null {
  switch ((name ?? '').toLowerCase()) {
    case '':
      return null;
    case 'minimal':
      return ThinkingLevel.MINIMAL;
    case 'low':
      return ThinkingLevel.LOW;
    case 'medium':
      return ThinkingLevel.MEDIUM;
    case 'high':
      return ThinkingLevel.HIGH;
    default:
      return null;
  }
}

export type GeminiOptions = { apiKey: string; model: string; thinking?: string };

export function createGeminiLlm(opts: GeminiOptions): Llm {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const level = thinkingLevel(opts.thinking);
  return {
    provider: 'gemini',
    model: opts.model,
    async complete(system, user) {
      const res = await withRetry(() =>
        ai.models.generateContent({
          model: opts.model,
          contents: user,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            temperature: 0.2,
            // Thinking tokens count toward this limit, so keep it generous.
            maxOutputTokens: 2048,
            ...(level ? { thinkingConfig: { thinkingLevel: level } } : {}),
          },
        }),
      );
      const u = res.usageMetadata;
      return {
        text: res.text ?? '',
        inputTokens: u?.promptTokenCount ?? 0,
        outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
      };
    },
  };
}
