import { describe, expect, it } from 'vitest';
import type { AcademicItem } from '../../src/models/academic-item.js';
import { isMeaningfulChange } from '../../src/scheduler/novelties.js';

function item(metadata: Record<string, string> = {}): AcademicItem {
  return {
    id: 'UVV-AOP003',
    externalId: 'ead:/mod/quiz/view.php:8603',
    source: 'PORTAL',
    sourceUrl: 'https://saladeaula.ead.uvv.br/mod/quiz/view.php?id=8603',
    title: 'Atividade Online Pontuada 03',
    description: 'Fecha: terça-feira, 13 out. 2026, 23:59',
    type: 'ASSIGNMENT',
    officialDeadline: '2026-10-13T23:59:00',
    firstSeenAt: '2026-10-02T12:00:00Z',
    lastSeenAt: '2026-10-02T12:00:00Z',
    contentHash: 'hash',
    status: 'TODO',
    urgency: 'FUTURE',
    metadata,
  };
}

describe('novidades relevantes', () => {
  it('não alerta quando o prazo oficial só confirma a data lida pela IA', () => {
    expect(
      isMeaningfulChange(item({ aiDueDate: '2026-10-13T23:59:00' }), [
        { field: 'officialDeadline', after: '2026-10-13T23:59:00' },
      ]),
    ).toBe(false);
  });

  it('alerta quando o prazo oficial difere da data lida pela IA ou muda', () => {
    expect(
      isMeaningfulChange(item({ aiDueDate: '2026-10-12' }), [
        { field: 'officialDeadline', after: '2026-10-13T23:59:00' },
      ]),
    ).toBe(true);
    expect(
      isMeaningfulChange(item(), [
        { field: 'officialDeadline', before: '2026-10-10T23:59:00', after: '2026-10-13T23:59:00' },
      ]),
    ).toBe(true);
  });

  it('ignora alterações sem campos visíveis e detalhamentos do mesmo post', () => {
    expect(isMeaningfulChange(item(), [])).toBe(false);
    expect(
      isMeaningfulChange(item({ originalTitle: 'Trabalho' }), [
        { field: 'description', before: 'Trabalho', after: 'Trabalho em grupo de até 4 pessoas' },
      ]),
    ).toBe(false);
  });
});
