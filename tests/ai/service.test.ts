import { describe, expect, it, vi } from 'vitest';
import { analysisInputHash, enrichItemsWithAi } from '../../src/ai/service.js';
import type { AiProvider } from '../../src/ai/types.js';
import type { AcademicItem } from '../../src/models/academic-item.js';

function makeItem(id: string): AcademicItem {
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
  };
}

describe('enriquecimento por IA', () => {
  it('salva análise estruturada nos metadados', async () => {
    const analyze = vi.fn<AiProvider['analyze']>().mockResolvedValue({
      plainSummary: 'A prova cobre dois capítulos.',
      actionItems: ['Revisar os capítulos'],
      studyTopics: ['Capítulo 1', 'Capítulo 2'],
      materials: [],
      openQuestions: ['Horário não informado'],
      certainty: 'CONFIRMED',
    });
    const result = await enrichItemsWithAi(
      [makeItem('UVV-1')],
      { name: 'fake', analyze },
      {
        maxCalls: 20,
        maxInputCharacters: 20_000,
      },
    );
    expect(result.calls).toBe(1);
    expect(result.items[0]?.metadata?.aiSummary).toBe('A prova cobre dois capítulos.');
    expect(JSON.parse(result.items[0]?.metadata?.aiStudyTopics ?? '[]')).toEqual([
      'Capítulo 1',
      'Capítulo 2',
    ]);
  });

  it('não cobra novamente por conteúdo já analisado', async () => {
    const item = makeItem('UVV-2');
    item.metadata = { aiInputHash: analysisInputHash(item), aiSummary: 'Já analisado' };
    const analyze = vi.fn<AiProvider['analyze']>();
    const result = await enrichItemsWithAi(
      [item],
      { name: 'fake', analyze },
      {
        maxCalls: 20,
        maxInputCharacters: 20_000,
      },
    );
    expect(result.calls).toBe(0);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('respeita o limite de chamadas por execução', async () => {
    const analyze = vi.fn<AiProvider['analyze']>().mockResolvedValue({
      plainSummary: 'Resumo',
      actionItems: [],
      studyTopics: [],
      materials: [],
      openQuestions: [],
      certainty: 'CONFIRMED',
    });
    const result = await enrichItemsWithAi(
      [makeItem('1'), makeItem('2')],
      { name: 'fake', analyze },
      {
        maxCalls: 1,
        maxInputCharacters: 20_000,
      },
    );
    expect(result.calls).toBe(1);
  });
});
