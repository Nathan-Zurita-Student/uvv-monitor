import { describe, expect, it } from 'vitest';
import type { DetectedItemCandidate } from '../../src/persistence/deduplication.js';
import { reconcilePortalDuplicates } from '../../src/portal/safe-collector.js';

function candidate(overrides: Partial<DetectedItemCandidate>): DetectedItemCandidate {
  return {
    externalId: 'post:1',
    source: 'PORTAL',
    sourceUrl: 'https://aluno.uvv.br/Aluno/Post/1',
    discipline: 'CC6N - Cálculo Numérico Computacional',
    title: 'EXPOINOVA INOVAWEEK 2026',
    description: 'Atividade EXPOINOVA',
    type: 'ASSIGNMENT',
    officialDeadline: '2026-09-23T23:00:00',
    metadata: { origin: 'CLASS_POST' },
    ...overrides,
  };
}

describe('reconciliação de fontes do Portal', () => {
  it('usa o calendário como contexto quando o post detalhado representa a mesma tarefa', () => {
    const calendar = candidate({
      externalId: 'calendar:1',
      sourceUrl: 'https://aluno.uvv.br/Calendario/Aluno',
      type: 'NOTICE',
      officialDate: '2026-09-23T23:00:00',
      metadata: { origin: 'CALENDAR' },
    });
    delete calendar.officialDeadline;
    const result = reconcilePortalDuplicates([candidate({}), calendar]);
    expect(result[1]?.metadata).toMatchObject({
      contextOnly: 'true',
      duplicateOf: 'post:1',
    });
  });
});
