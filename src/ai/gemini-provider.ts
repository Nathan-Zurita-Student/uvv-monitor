import { buildAcademicPrompt } from './prompt.js';
import { parseAcademicAnalysis, parseJsonObject } from './schema.js';
import type { AcademicAnalysis, AcademicAnalysisRequest, AiProvider } from './types.js';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
}

export class GeminiAiProvider implements AiProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async analyze(request: AcademicAnalysisRequest): Promise<AcademicAnalysis> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildAcademicPrompt(request) }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1_500,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(45_000),
      },
    );
    const payload = (await response.json()) as GeminiResponse;
    if (!response.ok) {
      throw new Error(
        `Gemini respondeu com HTTP ${String(response.status)}: ${payload.error?.message ?? 'erro'}`,
      );
    }
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
    if (!text) throw new Error('Gemini não retornou conteúdo analisável.');
    return parseAcademicAnalysis(parseJsonObject(text));
  }
}
