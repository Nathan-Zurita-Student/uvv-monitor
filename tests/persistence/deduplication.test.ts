import { describe, expect, it } from 'vitest';
import {
  deduplicateItems,
  type DetectedItemCandidate,
} from '../../src/persistence/deduplication.js';

const candidate: DetectedItemCandidate = {
  externalId: 'post:123',
  source: 'PORTAL',
  sourceUrl: 'https://aluno.uvv.br/Aluno/Post/123',
  discipline: 'Cálculo',
  title: 'AOP 1',
  description: 'Entregar exercícios',
  type: 'AOP',
  officialDeadline: '2026-10-02T23:59:00-03:00',
};

describe('deduplicação', () => {
  it('classifica item desconhecido como novo', () => {
    const result = deduplicateItems([candidate], [], '2026-09-30T12:00:00-03:00');
    expect(result.newItems).toHaveLength(1);
    expect(result.changedItems).toHaveLength(0);
  });

  it('não alerta novamente quando o hash não mudou', () => {
    const first = deduplicateItems([candidate], [], '2026-09-30T12:00:00-03:00').newItems[0]!;
    const result = deduplicateItems([candidate], [first], '2026-09-30T17:00:00-03:00');
    expect(result.unchangedItems).toHaveLength(1);
    expect(result.unchangedItems[0]?.lastSeenAt).toBe('2026-09-30T17:00:00-03:00');
  });

  it('detecta mudança de prazo e mantém o ID amigável', () => {
    const first = deduplicateItems([candidate], [], '2026-09-30T12:00:00-03:00').newItems[0]!;
    const changed = { ...candidate, officialDeadline: '2026-10-03T23:59:00-03:00' };
    const result = deduplicateItems([changed], [first], '2026-09-30T17:00:00-03:00');
    expect(result.changedItems[0]?.item.id).toBe(first.id);
    expect(result.changedItems[0]?.item.previousHash).toBe(first.contentHash);
    expect(result.changedItems[0]?.changes).toContainEqual({
      field: 'officialDeadline',
      before: candidate.officialDeadline,
      after: changed.officialDeadline,
    });
  });

  it('preserva status informado pelo usuário em atualizações', () => {
    const first = deduplicateItems([candidate], [], '2026-09-30T12:00:00-03:00').newItems[0]!;
    first.status = 'IN_PROGRESS';
    const result = deduplicateItems([{ ...candidate, description: 'Nova instrução' }], [first]);
    expect(result.changedItems[0]?.item.status).toBe('IN_PROGRESS');
  });
});
