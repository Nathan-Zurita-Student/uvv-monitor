import { describe, expect, it } from 'vitest';
import type { AcademicItem } from '../../src/models/academic-item.js';
import {
  classifyUrgency,
  prioritizeItems,
  selectProgressCheckins,
} from '../../src/prioritization/priority.js';

function item(overrides: Partial<AcademicItem>): AcademicItem {
  return {
    id: 'UVV-ABC123',
    externalId: '1',
    source: 'PORTAL',
    sourceUrl: 'https://aluno.uvv.br',
    title: 'Atividade',
    description: 'Entrega obrigatória',
    type: 'ASSIGNMENT',
    firstSeenAt: '2026-09-30T12:00:00-03:00',
    lastSeenAt: '2026-09-30T12:00:00-03:00',
    contentHash: 'hash',
    status: 'TODO',
    urgency: 'INFORMATIONAL',
    ...overrides,
  };
}

const now = new Date('2026-09-30T15:00:00Z'); // 12:00 em São Paulo

describe('prioridade determinística', () => {
  it.each([
    ['2026-09-29T23:59:00', 'OVERDUE'],
    ['2026-09-30T23:59:00', 'TODAY'],
    ['2026-10-01T10:00:00', 'NEXT_24_HOURS'],
    ['2026-10-02T12:00:00', 'NEXT_72_HOURS'],
    ['2026-10-05T12:00:00', 'THIS_WEEK'],
    ['2026-10-20T12:00:00', 'FUTURE'],
  ] as const)('classifica %s como %s no fuso local', (deadline, expected) => {
    expect(classifyUrgency(item({ officialDeadline: deadline }), now)).toBe(expected);
  });

  it('remove concluídos e prioriza atrasados', () => {
    const result = prioritizeItems(
      [
        item({ id: 'UVV-FUTURE', officialDeadline: '2026-10-20T12:00:00' }),
        item({ id: 'UVV-LATE', officialDeadline: '2026-09-29T12:00:00' }),
        item({ id: 'UVV-DONE', status: 'DONE', officialDeadline: '2026-09-29T12:00:00' }),
      ],
      now,
    );
    expect(result.map((entry) => entry.id)).toEqual(['UVV-LATE', 'UVV-FUTURE']);
  });

  it('seleciona no máximo três check-ins e ignora em andamento', () => {
    const items = Array.from({ length: 5 }, (_, index) =>
      item({
        id: `UVV-${String(index).padStart(6, '0')}`,
        officialDeadline: '2026-10-01T10:00:00',
      }),
    );
    items[0]!.status = 'IN_PROGRESS';
    expect(selectProgressCheckins(items, new Map(), now)).toHaveLength(3);
    expect(
      selectProgressCheckins(items, new Map(), now).some((entry) => entry.status === 'IN_PROGRESS'),
    ).toBe(false);
  });
});
