import { describe, expect, it, vi } from 'vitest';
import { parseAcademicAnalysis } from '../../src/ai/schema.js';
import {
  analysisInputHash,
  analysisQueue,
  enrichItemsWithAi,
  verifiedDueDate,
} from '../../src/ai/service.js';
import type { AcademicAnalysis, AiProvider } from '../../src/ai/types.js';
import type { AcademicItem } from '../../src/models/academic-item.js';

const now = new Date('2026-10-02T15:00:00Z');

function makeItem(id: string, overrides: Partial<AcademicItem> = {}): AcademicItem {
  return {
    id,
    externalId: id,
    source: 'PORTAL',
    sourceUrl: 'https://example.com',
    title: 'Prova',
    description: 'Estudar capítulos 1 e 2',
    type: 'EXAM',
    firstSeenAt: '2026-10-01T12:00:00Z',
    lastSeenAt: '2026-10-01T12:00:00Z',
    contentHash: 'hash',
    status: 'TODO',
    urgency: 'THIS_WEEK',
    ...overrides,
  };
}

const baseAnalysis: AcademicAnalysis = {
  plainSummary: 'A prova cobre dois capítulos.',
  actionItems: ['Revisar os capítulos'],
  studyTopics: ['Capítulo 1', 'Capítulo 2'],
  materials: [],
  openQuestions: ['Horário não informado'],
  certainty: 'CONFIRMED',
};

function fakeProvider(response: unknown = baseAnalysis) {
  const generateJson = vi.fn<AiProvider['generateJson']>().mockResolvedValue(response);
  return { generateJson, provider: { name: 'fake', generateJson } satisfies AiProvider };
}

const options = { maxCalls: 20, maxInputCharacters: 20_000, now };

describe('enriquecimento por IA', () => {
  it('salva análise estruturada nos metadados', async () => {
    const { provider } = fakeProvider({
      ...baseAnalysis,
      displayTitle: 'Prova do 1º bimestre',
      relevance: 'ACTION_REQUIRED',
    });
    const result = await enrichItemsWithAi([makeItem('UVV-1')], provider, options);
    const metadata = result.items[0]?.metadata;
    expect(result.calls).toBe(1);
    expect(metadata?.aiSummary).toBe('A prova cobre dois capítulos.');
    expect(metadata?.aiDisplayTitle).toBe('Prova do 1º bimestre');
    expect(metadata?.aiRelevance).toBe('ACTION_REQUIRED');
    expect(JSON.parse(metadata?.aiStudyTopics ?? '[]')).toEqual(['Capítulo 1', 'Capítulo 2']);
  });

  it('não cobra novamente por conteúdo já analisado', async () => {
    const item = makeItem('UVV-2');
    item.metadata = { aiInputHash: analysisInputHash(item), aiSummary: 'Já analisado' };
    const { provider, generateJson } = fakeProvider();
    const result = await enrichItemsWithAi([item], provider, options);
    expect(result.calls).toBe(0);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('respeita o limite de chamadas por execução', async () => {
    const { provider } = fakeProvider();
    const result = await enrichItemsWithAi([makeItem('1'), makeItem('2')], provider, {
      ...options,
      maxCalls: 1,
    });
    expect(result.calls).toBe(1);
    expect(result.items).toHaveLength(2);
  });

  it('descarta dados antigos da IA ao reanalisar', async () => {
    const item = makeItem('UVV-3', {
      metadata: { origin: 'CLASS_POST', aiDueDate: '2026-10-09', aiInputHash: 'antigo' },
    });
    const { provider } = fakeProvider();
    const result = await enrichItemsWithAi([item], provider, options);
    expect(result.items[0]?.metadata?.aiDueDate).toBeUndefined();
    expect(result.items[0]?.metadata?.origin).toBe('CLASS_POST');
  });
});

describe('fila de análise', () => {
  it('analisa primeiro as novidades, depois provas e tarefas pela data', () => {
    const queue = analysisQueue(
      [
        makeItem('AVISO', { type: 'NOTICE' }),
        makeItem('PROVA-LONGE', { officialDate: '2026-11-20' }),
        makeItem('PROVA-PERTO', { officialDate: '2026-10-05' }),
        makeItem('NOVA', { type: 'NOTICE' }),
      ],
      new Set(['NOVA']),
      now,
    );
    expect(queue.map((item) => item.id)).toEqual(['NOVA', 'PROVA-PERTO', 'PROVA-LONGE', 'AVISO']);
  });

  it('ignora itens de contexto e prazos vencidos há muito tempo', () => {
    const queue = analysisQueue(
      [
        makeItem('CONTEXTO', { metadata: { contextOnly: 'true' } }),
        makeItem('ANTIGA', { officialDate: '2026-05-10' }),
      ],
      new Set(),
      now,
    );
    expect(queue).toEqual([]);
  });
});

describe('data identificada pela IA', () => {
  const post = makeItem('UVV-POST', {
    type: 'NOTICE',
    description: 'Pessoal, a entrega do relatório será no dia 15/10 até as 23h59.',
  });

  it('aceita a data quando o trecho existe no texto e contém o dia', () => {
    const due = verifiedDueDate(
      {
        ...baseAnalysis,
        dueDate: { date: '2026-10-15', time: '23:59', evidence: 'no dia 15/10 até as 23h59' },
      },
      post,
      now,
    );
    expect(due?.date).toBe('2026-10-15');
  });

  it('rejeita trecho que não aparece no texto', () => {
    expect(
      verifiedDueDate(
        { ...baseAnalysis, dueDate: { date: '2026-10-15', evidence: 'prova dia 15/10' } },
        post,
        now,
      ),
    ).toBeUndefined();
  });

  it('rejeita data cujo dia não aparece no trecho citado', () => {
    expect(
      verifiedDueDate(
        { ...baseAnalysis, dueDate: { date: '2026-10-16', evidence: 'no dia 15/10' } },
        post,
        now,
      ),
    ).toBeUndefined();
  });
});

describe('validação da resposta', () => {
  it('tolera campos opcionais inválidos e listas longas', () => {
    const parsed = parseAcademicAnalysis({
      ...baseAnalysis,
      suggestedType: 'LESSON',
      relevance: 'TALVEZ',
      dueDate: { date: '15/10', evidence: 'dia 15' },
      certainty: 'ALTA',
      actionItems: Array.from({ length: 20 }, (_, index) => `Ação ${String(index)}`),
    });
    expect(parsed.suggestedType).toBeUndefined();
    expect(parsed.relevance).toBeUndefined();
    expect(parsed.dueDate).toBeUndefined();
    expect(parsed.certainty).toBe('NOT_INFORMED');
    expect(parsed.actionItems).toHaveLength(8);
  });
});
