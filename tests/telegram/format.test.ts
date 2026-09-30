import { describe, expect, it } from 'vitest';
import type { AcademicItem } from '../../src/models/academic-item.js';
import { formatPriorities, formatProgressCheck } from '../../src/telegram/format.js';

function item(overrides: Partial<AcademicItem> = {}): AcademicItem {
  return {
    id: 'UVV-ABC123',
    externalId: '1',
    source: 'PORTAL',
    sourceUrl: 'https://aluno.uvv.br',
    discipline: 'Cálculo Numérico',
    title: 'Entregar AOP',
    description: 'Enviar os exercícios',
    type: 'AOP',
    officialDeadline: '2026-10-02T23:59:00',
    firstSeenAt: '2026-09-30T12:00:00-03:00',
    lastSeenAt: '2026-09-30T12:00:00-03:00',
    contentHash: 'hash',
    status: 'TODO',
    urgency: 'NEXT_72_HOURS',
    ...overrides,
  };
}

describe('mensagens naturais do Telegram', () => {
  it('omite comunicados informativos do resumo de prioridades', () => {
    const result = formatPriorities([
      item(),
      item({ id: 'UVV-NOTICE1', title: 'Comunicado antigo', urgency: 'INFORMATIONAL' }),
    ]);
    expect(result).toContain('Entregar AOP');
    expect(result).not.toContain('Comunicado antigo');
    expect(result).toContain('sexta-feira, 02/10/2026, às 23h59');
    expect(result).toContain('Basta tocar em um botão');
  });

  it('cria uma pergunta individual sem exigir comando', () => {
    const result = formatProgressCheck(item());
    expect(result).toContain('COMO ESTÁ ESSA TAREFA?');
    expect(result).toContain('Você não precisa digitar o código');
    expect(result).not.toContain('/feito');
  });

  it('não gera resumo quando só existem informações sem ação', () => {
    expect(formatPriorities([item({ urgency: 'INFORMATIONAL' })])).toBe('');
  });
});
