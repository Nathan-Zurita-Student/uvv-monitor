import { describe, expect, it } from 'vitest';
import type { AcademicItem } from '../../src/models/academic-item.js';
import {
  formatCompleteTaskSummary,
  formatPriorities,
  formatPriorityTask,
  formatProgressCheck,
} from '../../src/telegram/format.js';

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
    expect(result).toContain('🔗 Abrir no Portal UVV: https://aluno.uvv.br');
  });

  it('cria uma pergunta individual sem exigir comando', () => {
    const result = formatProgressCheck(item());
    expect(result).toContain('COMO ESTÁ ESSA TAREFA?');
    expect(result).toContain('Use um dos botões do teclado abaixo');
    expect(result).toContain('🔗 Abrir no Portal UVV: https://aluno.uvv.br');
    expect(result).not.toContain('/feito');
  });

  it('não gera resumo quando só existem informações sem ação', () => {
    expect(formatPriorities([item({ urgency: 'INFORMATIONAL' })])).toBe('');
  });

  it('formata uma tarefa individual com situação natural', () => {
    const result = formatPriorityTask(item());
    expect(result).toContain('🟠 Entregar AOP');
    expect(result).toContain('📅 Próximas 72 horas — sexta-feira, 02/10/2026, às 23h59');
    expect(result).toContain('📊 Situação atual: ⏳ Ainda não comecei');
    expect(result).toContain('🆔 UVV-ABC123');
    expect(result).not.toContain('https://');
  });

  it('inclui todas as pendências no resumo completo e preserva os links', () => {
    const items = Array.from({ length: 9 }, (_, index) =>
      item({
        id: `UVV-${String(index).padStart(6, '0')}`,
        title: `Tarefa ${String(index + 1)}`,
      }),
    );
    const messages = formatCompleteTaskSummary(items);
    const combined = messages.join('\n');
    expect(combined).toContain('Você tem 9 pendência(s) aberta(s)');
    expect(combined).toContain('Tarefa 1');
    expect(combined).toContain('Tarefa 9');
    expect(combined).toContain('https://aluno.uvv.br');
  });
});
