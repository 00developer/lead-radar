// One small wrapper so the classifier does not care which LLM provider is used.
// Default provider is Gemini (owner's choice, 2026-09-30). Anthropic stays available for a comparison run.
//
// Env:
//   LLM_PROVIDER      gemini (default) | anthropic
//   CLASSIFIER_MODEL  model id. Default gemini-3.8-flash (Gemini) or claude-haiku-4-5-20251001 (Anthropic)
//   GEMINI_API_KEY    required for gemini
//   GEMINI_THINKING   low (default) | minimal | medium | high | none  (none = do not send a thinking setting)
//   ANTHROPIC_API_KEY required for anthropic

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { need } from './config.js';

export type LlmResult = { text: string; inputTokens: number; outputTokens: number };

export interface Llm {
  provider: 'gemini' | 'anthropic';
  model: string;
  complete(system: string, user: string): Promise<LlmResult>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries temporary failures (rate limit or overload) a few times with growing waits. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const waits = [5_000, 15_000, 30_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const temporary = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|overloaded|rate/i.test(msg);
      if (!temporary || attempt >= waits.length) throw e;
      await sleep(waits[attempt]);
    }
  }
}

function thinkingLevel(name: string): ThinkingLevel | null {
  switch (name.toLowerCase()) {
    case 'none':
      return null;
    case 'minimal':
      return ThinkingLevel.MINIMAL;
    case 'medium':
      return ThinkingLevel.MEDIUM;
    case 'high':
      return ThinkingLevel.HIGH;
    default:
      return ThinkingLevel.LOW;
  }
}

function geminiLlm(): Llm {
  const model = process.env.CLASSIFIER_MODEL || 'gemini-3.8-flash';
  const ai = new GoogleGenAI({ apiKey: need('GEMINI_API_KEY') });
  const level = thinkingLevel(process.env.GEMINI_THINKING || 'low');
  return {
    provider: 'gemini',
    model,
    async complete(system, user) {
      const res = await withRetry(() =>
        ai.models.generateContent({
          model,
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

function anthropicLlm(): Llm {
  const model = process.env.CLASSIFIER_MODEL || 'claude-haiku-4-5-20251001';
  const client = new Anthropic({ apiKey: need('ANTHROPIC_API_KEY') });
  return {
    provider: 'anthropic',
    model,
    async complete(system, user) {
      const msg = await withRetry(() =>
        client.messages.create({ model, max_tokens: 700, system, messages: [{ role: 'user', content: user }] }),
      );
      return {
        text: msg.content.map((b) => (b.type === 'text' ? b.text : '')).join(''),
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
      };
    },
  };
}

export function createLlm(): Llm {
  const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'gemini') return geminiLlm();
  if (provider === 'anthropic') return anthropicLlm();
  throw new Error(`LLM_PROVIDER must be "gemini" or "anthropic", got "${provider}"`);
}
