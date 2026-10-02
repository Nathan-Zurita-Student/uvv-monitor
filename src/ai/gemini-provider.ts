import { parseJsonObject } from './schema.js';
import type { AiProvider } from './types.js';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string; details?: Array<{ retryDelay?: string }> };
}

export interface GeminiRequestPolicy {
  /** Intervalo mÃ­nimo entre requisiÃ§Ãµes; o plano gratuito aceita 15 por minuto. */
  minIntervalMs: number;
  /** Novas tentativas para HTTP 429/5xx antes de desistir do item. */
  maxRetries: number;
  wait: (ms: number) => Promise<void>;
}

const defaultPolicy: GeminiRequestPolicy = {
  minIntervalMs: 4_500,
  maxRetries: 2,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const retryableStatuses = new Set([429, 500, 502, 503, 504]);
const maxRetryDelayMs = 60_000;

export function retryDelayMs(payload: GeminiResponse, attempt: number): number {
  const hinted =
    payload.error?.details?.find((detail) => detail.retryDelay)?.retryDelay ??
    /retry in ([\d.]+)s/i.exec(payload.error?.message ?? '')?.[1];
  const seconds = hinted ? Number.parseFloat(hinted) : Number.NaN;
  const delay = Number.isFinite(seconds) ? Math.ceil(seconds * 1_000) + 500 : 5_000 * 3 ** attempt;
  return Math.min(delay, maxRetryDelayMs);
}

export class GeminiAiProvider implements AiProvider {
  readonly name = 'gemini';
  private lastRequestAt = 0;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly policy: GeminiRequestPolicy = defaultPolicy,
  ) {}

  async generateJson(prompt: string): Promise<unknown> {
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1_500,
        responseMimeType: 'application/json',
      },
    });
    for (let attempt = 0; ; attempt += 1) {
      await this.throttle();
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
          body,
          signal: AbortSignal.timeout(45_000),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as GeminiResponse;
      if (response.ok) {
        const text = payload.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? '')
          .join('');
        if (!text) throw new Error('Gemini nÃ£o retornou conteÃºdo analisÃ¡vel.');
        return parseJsonObject(text);
      }
      if (!retryableStatuses.has(response.status) || attempt >= this.policy.maxRetries) {
        throw new Error(
          `Gemini respondeu com HTTP ${String(response.status)}: ${payload.error?.message ?? 'erro'}`,
        );
      }
      await this.policy.wait(retryDelayMs(payload, attempt));
    }
  }

  private async throttle(): Promise<void> {
    const remaining = this.policy.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (remaining > 0) await this.policy.wait(remaining);
    this.lastRequestAt = Date.now();
  }
}
