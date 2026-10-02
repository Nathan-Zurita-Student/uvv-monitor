import { parseJsonObject } from './schema.js';
import type { AiProvider } from './types.js';

interface OpenAiResponse {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async generateJson(prompt: string): Promise<unknown> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: prompt,
        max_output_tokens: 1_500,
        text: { format: { type: 'json_object' } },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      throw new Error(
        `OpenAI respondeu com HTTP ${String(response.status)}: ${payload.error?.message ?? 'erro'}`,
      );
    }
    const text =
      payload.output_text ??
      payload.output?.flatMap((entry) => entry.content ?? []).find((entry) => entry.text)?.text;
    if (!text) throw new Error('OpenAI não retornou conteúdo analisável.');
    return parseJsonObject(text);
  }
}
