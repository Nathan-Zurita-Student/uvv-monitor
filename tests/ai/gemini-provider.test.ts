import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiAiProvider, retryDelayMs } from '../../src/ai/gemini-provider.js';
import { parseAcademicAnalysis } from '../../src/ai/schema.js';
import type { AcademicItem } from '../../src/models/academic-item.js';

const item: AcademicItem = {
  id: 'UVV-1',
  externalId: 'post:1',
  source: 'PORTAL',
  sourceUrl: 'https://example.com',
  title: 'Prova P1',
  description: 'Estudar unidades 1 a 4',
  type: 'EXAM',
  firstSeenAt: '2026-10-01T12:00:00Z',
  lastSeenAt: '2026-10-01T12:00:00Z',
  contentHash: 'hash',
  status: 'TODO',
  urgency: 'THIS_WEEK',
};

const analysis = {
  plainSummary: 'Prova das unidades 1 a 4.',
  actionItems: ['Revisar unidades 1 a 4'],
  studyTopics: [],
  materials: [],
  openQuestions: [],
  certainty: 'CONFIRMED',
};

function ok(): Response {
  return Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] } }],
  });
}

function failure(status: number, error: object): Response {
  return Response.json({ error }, { status });
}

function provider(wait = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue()) {
  return {
    wait,
    gemini: new GeminiAiProvider('key', 'model', { minIntervalMs: 0, maxRetries: 2, wait }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provedor Gemini', () => {
  it('tenta novamente após sobrecarga temporária', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(failure(503, { message: 'high demand' }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);
    const { gemini, wait } = provider();
    const result = await gemini.analyze({ item, maxInputCharacters: 20_000 });
    expect(result.plainSummary).toBe('Prova das unidades 1 a 4.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(5_000);
  });

  it('respeita o tempo de espera informado no limite de cota', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(failure(429, { message: 'quota', details: [{ retryDelay: '13s' }] }))
        .mockResolvedValueOnce(ok()),
    );
    const { gemini, wait } = provider();
    await gemini.analyze({ item, maxInputCharacters: 20_000 });
    expect(wait).toHaveBeenCalledWith(13_500);
  });

  it('desiste após o limite de novas tentativas', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(failure(503, { message: 'high demand' })));
    vi.stubGlobal('fetch', fetchMock);
    const { gemini } = provider();
    await expect(gemini.analyze({ item, maxInputCharacters: 20_000 })).rejects.toThrow('HTTP 503');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('não repete erros definitivos', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(failure(400, { message: 'bad request' }));
    vi.stubGlobal('fetch', fetchMock);
    const { gemini } = provider();
    await expect(gemini.analyze({ item, maxInputCharacters: 20_000 })).rejects.toThrow('HTTP 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('usa o atraso sugerido na mensagem quando não há detalhes', () => {
    expect(retryDelayMs({ error: { message: 'Please retry in 2.5s.' } }, 0)).toBe(3_000);
    expect(retryDelayMs({ error: { details: [{ retryDelay: '600s' }] } }, 0)).toBe(60_000);
  });
});

describe('validação da análise', () => {
  it('ignora tipo sugerido fora da lista sem descartar a análise', () => {
    const parsed = parseAcademicAnalysis({ ...analysis, suggestedType: 'LESSON' });
    expect(parsed.plainSummary).toBe('Prova das unidades 1 a 4.');
    expect(parsed.suggestedType).toBeUndefined();
  });
});
