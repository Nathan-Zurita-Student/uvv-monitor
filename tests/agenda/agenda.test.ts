import { describe, expect, it } from 'vitest';
import { buildAgenda, selectCheckins, upcoming } from '../../src/agenda/agenda.js';
import { displayTitle, effectiveType, focusKind, publishedAt } from '../../src/agenda/focus.js';
import type { AcademicItem } from '../../src/models/academic-item.js';

const now = new Date('2026-10-02T15:00:00Z'); // sexta-feira, 12h em São Paulo

let sequence = 0;
function item(overrides: Partial<AcademicItem> = {}): AcademicItem {
  sequence += 1;
  return {
    id: `UVV-${String(sequence).padStart(6, '0')}`,
    externalId: String(sequence),
    source: 'PORTAL',
    sourceUrl: 'https://aluno.uvv.br',
    discipline: 'Cálculo Numérico',
    title: 'Item',
    description: 'Descrição',
    type: 'ASSIGNMENT',
    firstSeenAt: '2026-10-01T12:00:00Z',
    lastSeenAt: '2026-10-01T12:00:00Z',
    contentHash: 'hash',
    status: 'TODO',
    urgency: 'INFORMATIONAL',
    ...overrides,
  };
}

describe('classificação de foco', () => {
  it('usa o tipo da IA para corrigir fontes livres, mas não as oficiais', () => {
    const survey = item({
      type: 'EXAM',
      metadata: { origin: 'MESSAGE', aiSuggestedType: 'NOTICE' },
    });
    const official = item({
      type: 'EXAM',
      metadata: { origin: 'OFFICIAL_EXAM_SCHEDULE', aiSuggestedType: 'NOTICE' },
    });
    expect(effectiveType(survey)).toBe('NOTICE');
    expect(focusKind(survey)).toBeUndefined();
    expect(focusKind(official)).toBe('EXAM');
  });

  it('reconhece o calendário oficial de provas mesmo vindo como mensagem do Portal', () => {
    const scheduled = item({
      type: 'EXAM',
      externalId: 'exam-schedule:CC6N:FIRST_TERM:LFA',
      metadata: { origin: 'MESSAGE', assessment: 'FIRST_TERM', aiSuggestedType: 'NOTICE' },
    });
    expect(focusKind(scheduled)).toBe('EXAM');
  });

  it('descarta itens que a IA considerou irrelevantes', () => {
    const job = item({ source: 'GMAIL', metadata: { aiRelevance: 'IRRELEVANT' } });
    expect(focusKind(job)).toBeUndefined();
  });

  it('limpa o título removendo a disciplina e abreviando AOP', () => {
    expect(
      displayTitle(
        item({
          title: 'Prova do 1º bimestre — Cálculo Numérico',
          metadata: { origin: 'OFFICIAL_EXAM_SCHEDULE' },
        }),
      ),
    ).toBe('Prova do 1º bimestre');
    expect(displayTitle(item({ title: 'Atividade Online Pontuada 02' }))).toBe('AOP 02');
  });

  it('estima a publicação pelo sufixo das mensagens do Portal', () => {
    const message = item({ title: 'PROVA FINAIS 07jul', metadata: { origin: 'MESSAGE' } });
    expect(publishedAt(message, now).toISOString().slice(0, 10)).toBe('2026-07-07');
  });
});

describe('agenda', () => {
  it('separa provas, entregas, atrasos, 2ª chamada e itens sem data', () => {
    const agenda = buildAgenda(
      [
        item({ type: 'EXAM', title: 'Prova P1', officialDate: '2026-10-05' }),
        item({ type: 'EXAM', title: 'Prova que já passou', officialDate: '2026-09-28' }),
        item({
          type: 'EXAM',
          title: 'Prova de 2ª chamada — Cálculo Numérico',
          officialDate: '2026-11-25',
          metadata: { origin: 'OFFICIAL_EXAM_SCHEDULE', assessment: 'SECOND_CALL' },
        }),
        item({ title: 'Trabalho', officialDeadline: '2026-10-14T23:59:00' }),
        item({ title: 'AOP atrasada', officialDeadline: '2026-09-25T23:59:00' }),
        item({ title: 'AOP muito antiga', officialDeadline: '2026-07-01T23:59:00' }),
        item({ title: 'Trabalho sem data', metadata: { origin: 'CLASS_POST' } }),
        item({ title: 'E-mail sem confirmação', source: 'GMAIL' }),
        item({ title: 'Concluído', officialDeadline: '2026-10-10', status: 'DONE' }),
      ],
      now,
    );
    expect(agenda.exams.map((entry) => entry.item.title)).toEqual(['Prova P1']);
    expect(agenda.exams[0]?.days).toBe(3);
    expect(agenda.conditionalExams).toHaveLength(1);
    expect(agenda.tasks.map((entry) => entry.item.title)).toEqual(['Trabalho']);
    expect(agenda.overdue.map((entry) => entry.item.title)).toEqual(['AOP atrasada']);
    expect(agenda.undated.map((entry) => entry.item.title)).toEqual(['Trabalho sem data']);
  });

  it('mantém uma entrega com só o dia informado até o fim desse dia', () => {
    const evening = new Date('2026-10-02T23:00:00Z'); // 20h em São Paulo
    const agenda = buildAgenda([item({ title: 'Lista', officialDate: '2026-10-02' })], evening);
    expect(agenda.tasks).toHaveLength(1);
    expect(agenda.overdue).toHaveLength(0);
  });

  it('une a mesma prova vinda do calendário oficial e de um post do professor', () => {
    const agenda = buildAgenda(
      [
        item({
          type: 'EXAM',
          title: 'Prova — Cálculo Numérico',
          officialDate: '2026-10-05',
          metadata: { origin: 'CLASS_POST', aiStudyTopics: '["Interpolação"]' },
        }),
        item({
          type: 'EXAM',
          title: 'Prova do 1º bimestre — Cálculo Numérico',
          officialDate: '2026-10-05',
          metadata: { origin: 'OFFICIAL_EXAM_SCHEDULE' },
        }),
      ],
      now,
    );
    expect(agenda.exams).toHaveLength(1);
    expect(agenda.exams[0]?.item.metadata?.origin).toBe('OFFICIAL_EXAM_SCHEDULE');
    expect(agenda.exams[0]?.related).toHaveLength(1);
  });

  it('não confunde atividades diferentes da mesma disciplina e dia', () => {
    const agenda = buildAgenda(
      [
        item({
          title: 'Atividade Online Pontuada 01',
          officialDeadline: '2026-10-15T23:59:00',
          metadata: { origin: 'EAD' },
        }),
        item({
          title: 'Atividade Online Pontuada 02',
          officialDeadline: '2026-10-15T23:59:00',
          metadata: { origin: 'EAD' },
        }),
        item({
          title: 'LINK Atividade Online Pontuada 02',
          officialDeadline: '2026-10-15T23:59:00',
          metadata: { origin: 'CALENDAR' },
        }),
      ],
      now,
    );
    expect(agenda.tasks.map((entry) => entry.item.title)).toEqual([
      'Atividade Online Pontuada 01',
      'Atividade Online Pontuada 02',
    ]);
    expect(agenda.tasks[1]?.related.map((related) => related.title)).toEqual([
      'LINK Atividade Online Pontuada 02',
    ]);
  });

  it('usa a data encontrada pela IA quando não há data oficial', () => {
    const agenda = buildAgenda(
      [item({ title: 'Relatório', metadata: { origin: 'CLASS_POST', aiDueDate: '2026-10-09' } })],
      now,
    );
    expect(agenda.tasks[0]?.date?.source).toBe('AI');
    expect(agenda.tasks[0]?.days).toBe(7);
  });

  it('esconde itens sem data publicados há muito tempo', () => {
    const agenda = buildAgenda(
      [item({ type: 'EXAM', title: 'PROVA FINAIS 07jul', metadata: { origin: 'MESSAGE' } })],
      now,
    );
    expect(agenda.undated).toEqual([]);
  });

  it('seleciona perguntas de andamento para atrasos recentes e os próximos 3 dias', () => {
    const agenda = buildAgenda(
      [
        item({ title: 'Atrasada', officialDeadline: '2026-09-30T23:59:00' }),
        item({ type: 'EXAM', title: 'Prova', officialDate: '2026-10-04' }),
        item({ title: 'Longe', officialDeadline: '2026-10-20T23:59:00' }),
        item({ title: 'Aguardando', officialDeadline: '2026-10-03T23:59:00', status: 'WAITING' }),
      ],
      now,
    );
    expect(selectCheckins(agenda, new Set()).map((entry) => entry.item.title)).toEqual([
      'Atrasada',
      'Aguardando',
      'Prova',
    ]);
    expect(upcoming(agenda, 7).map((entry) => entry.item.title)).toEqual(['Aguardando', 'Prova']);
  });
});
