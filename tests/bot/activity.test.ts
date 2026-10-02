import { describe, expect, it } from 'vitest';
import { toAgendaEntry } from '../../src/agenda/agenda.js';
import {
  countdownLine,
  itemLabel,
  naturalSentence,
  shortDiscipline,
} from '../../src/bot/activity.js';
import { effectiveStatus, applyUserStatuses } from '../../src/bot/status.js';
import { exam, item, now } from './fixtures.js';

function entry(source = item()) {
  const result = toAgendaEntry(source, now);
  if (!result) throw new Error('entrada esperada');
  return result;
}

describe('nomes curtos', () => {
  it('encurta disciplinas longas sem perder o sentido', () => {
    expect(shortDiscipline('Aspectos Legais da Tecnologia da Informação')).toBe('Aspectos Legais');
    expect(shortDiscipline('Governança em Tecnologia da Informação')).toBe('Governança em TI');
    expect(shortDiscipline('Linguagens Formais e Autômatos')).toBe('Linguagens Formais');
    expect(shortDiscipline('Desenvolvimento de Games')).toBe('Games');
    expect(shortDiscipline('Empreendedorismo e Negócios - Humanas')).toBe(
      'Empreendedorismo e Negócios',
    );
  });

  it('monta o nome exibido de atividades e provas', () => {
    expect(itemLabel(item())).toBe('AOP 03 — Aspectos Legais');
    expect(itemLabel(exam())).toBe('Prova de Linguagens Formais (1º bim.)');
  });
});

describe('frases naturais', () => {
  it('descreve um questionário com pontos, abertura e prazo', () => {
    expect(naturalSentence(entry(), now)).toBe(
      'É um questionário que vale 2 pontos. Abre em 06/10 e vai até 13/10 às 23:59.',
    );
  });

  it('descreve um questionário já aberto', () => {
    const open = item({ metadata: { origin: 'EAD', moodleModule: 'quiz', points: '2' } });
    expect(naturalSentence(entry(open), now)).toBe(
      'É um questionário que vale 2 pontos e pode ser feito até 13/10 às 23:59.',
    );
  });

  it('descreve a data da prova', () => {
    expect(naturalSentence(entry(exam()), now)).toBe('A prova do 1º bimestre é segunda, 05/10.');
  });

  it('muda o tom da contagem conforme o prazo', () => {
    expect(countdownLine(entry(), now)).toBe('⏳ Faltam 11 dias.');
    expect(countdownLine(entry(item({ officialDeadline: '2026-10-02T23:59:00' })), now)).toBe(
      '🚨 Vence hoje às 23:59.',
    );
    expect(countdownLine(entry(item({ officialDeadline: '2026-10-03T23:59:00' })), now)).toBe(
      '⚠️ Vence amanhã às 23:59.',
    );
    expect(countdownLine(entry(item({ officialDeadline: '2026-09-30T23:59:00' })), now)).toBe(
      '🔴 Venceu há 2 dias.',
    );
  });
});

describe('status do usuário x status da fonte', () => {
  it('prioriza o que o usuário marcou, exceto quando a fonte confirma a conclusão', () => {
    expect(effectiveStatus('TODO', 'DONE')).toBe('DONE');
    expect(effectiveStatus('TODO', 'IGNORED')).toBe('IGNORED');
    expect(effectiveStatus('DONE', 'IN_PROGRESS')).toBe('DONE');
    expect(effectiveStatus('WAITING')).toBe('WAITING');
  });

  it('não perde a conclusão quando a coleta encontra a atividade de novo', () => {
    const collected = item({ status: 'TODO' });
    const [result] = applyUserStatuses(
      [collected],
      [{ itemId: collected.id, status: 'DONE', updatedAt: now.toISOString(), source: 'TELEGRAM' }],
    );
    expect(result?.status).toBe('DONE');
  });
});
