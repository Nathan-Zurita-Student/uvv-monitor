import { describe, expect, it } from 'vitest';
import { buildAgenda } from '../../src/agenda/agenda.js';
import { academicCategory, summarizeEntry } from '../../src/assistant/catalog.js';
import { addDays, dateReference, weekOf, zonedInstant } from '../../src/assistant/dates.js';
import { freeSlots } from '../../src/assistant/free-time.js';
import { computeInsights, prioritize } from '../../src/assistant/insights.js';
import { buildMemoryFact, memoryContext, weeklySlots } from '../../src/assistant/memory.js';
import { buildTimeline, busyIntervals } from '../../src/assistant/timeline.js';
import type { CalendarEvent } from '../../src/assistant/types.js';
import { exam, item, now } from '../bot/fixtures.js';

const at = (day: string, time: string) => zonedInstant(day, time);

function event(overrides: Partial<CalendarEvent> & { id: string; title: string }): CalendarEvent {
  return {
    start: at('2026-10-05', '14:00'),
    end: at('2026-10-05', '15:00'),
    allDay: false,
    ...overrides,
  };
}

describe('datas em linguagem natural', () => {
  it('monta a tabela de referência com hoje, amanhã, semana e fim do mês', () => {
    const reference = dateReference(now, 10);
    expect(reference).toContain('sex 2026-10-02 (hoje)');
    expect(reference).toContain('sáb 2026-10-03 (amanhã)');
    expect(reference).toContain('sex 2026-10-09');
    expect(reference).toContain('Esta semana: 2026-09-28 a 2026-10-04');
    expect(reference).toContain('Semana que vem: 2026-10-05 a 2026-10-11');
    expect(reference).toContain('Fim do mês: 2026-10-31');
  });

  it('calcula semanas e dias no fuso de São Paulo', () => {
    expect(weekOf('2026-10-07')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(zonedInstant('2026-10-09', '14:00').toISOString()).toBe('2026-10-09T17:00:00.000Z');
  });
});

describe('contexto acadêmico centralizado', () => {
  it('classifica no vocabulário do aluno', () => {
    expect(academicCategory(exam())).toBe('prova');
    expect(academicCategory(item())).toBe('aop');
    expect(
      academicCategory(
        item({
          title: 'Trabalho final em grupo',
          type: 'ASSIGNMENT',
          metadata: { origin: 'MESSAGE' },
        }),
      ),
    ).toBe('trabalho');
    expect(
      academicCategory(
        item({ title: 'Lista de exercícios 2', type: 'ACTIVITY', metadata: { origin: 'MESSAGE' } }),
      ),
    ).toBe('exercicio');
    expect(
      academicCategory(
        item({ title: 'Seminário de Redes', type: 'ACTIVITY', metadata: { origin: 'MESSAGE' } }),
      ),
    ).toBe('seminario');
    expect(
      academicCategory(
        item({ title: 'Inscrições para estágio', type: 'NOTICE', metadata: { origin: 'MESSAGE' } }),
      ),
    ).toBe('estagio');
    expect(
      academicCategory(
        item({ title: 'Comunicado', type: 'NOTICE', metadata: { origin: 'MESSAGE' } }),
      ),
    ).toBe('aviso');
  });

  it('resume prova sem horário deixando claro que o horário não foi informado', () => {
    const agenda = buildAgenda([exam()], now);
    const summary = summarizeEntry(agenda.exams[0]!, now);
    expect(summary).toMatchObject({
      category: 'prova',
      date: '2026-10-05',
      daysLeft: 3,
      source: 'portal',
    });
    expect(summary.when).toContain('horário não informado');
    expect(summary.time).toBeUndefined();
  });
});

describe('linha do tempo sem duplicatas', () => {
  const aop = item();
  const prova = exam();
  const agenda = buildAgenda([aop, prova], now);

  it('junta Agenda, Portal/AVA, aulas da memória e lembretes, sem repetir o evento do monitor', () => {
    const memory = [
      buildMemoryFact(
        {
          category: 'aula',
          subject: 'Linguagens Formais',
          content: 'Aula presencial',
          weekdays: [1, 3],
          startTime: '19:00',
          endTime: '22:40',
        },
        [],
        now,
      ),
    ];
    const timeline = buildTimeline({
      from: '2026-10-05',
      to: '2026-10-05',
      now,
      agenda,
      events: [
        event({
          id: 'monitor',
          title: '[UVV] Prova — Linguagens Formais',
          academicItemId: prova.id,
        }),
        event({ id: 'dentista', title: 'Dentista' }),
      ],
      reminders: [
        {
          id: 'REM-1',
          title: 'Revisar autômatos',
          description: '',
          remindAt: at('2026-10-05', '09:00').toISOString(),
          urgent: false,
          chatId: '42',
        },
      ],
      slots: weeklySlots(memory),
    });
    expect(timeline.map((entry) => `${entry.kind}:${entry.start ?? '-'}:${entry.title}`)).toEqual([
      'lembrete:09:00:Revisar autômatos',
      'compromisso:14:00:Dentista',
      'aula:19:00:Aula de Linguagens Formais',
      'prova:-:Prova de Linguagens Formais (1º bim.)',
    ]);
    expect(timeline.find((entry) => entry.kind === 'prova')?.notes).toContain(
      'horário não informado pela faculdade',
    );
  });

  it('une um compromisso do usuário com a mesma prova e avisa quando os horários divergem', () => {
    const timed = exam({ officialDate: '2026-10-05T19:00:00' });
    const timeline = buildTimeline({
      from: '2026-10-05',
      to: '2026-10-05',
      now,
      agenda: buildAgenda([timed], now),
      events: [
        event({
          id: 'meu',
          title: 'Prova de Linguagens Formais',
          start: at('2026-10-05', '20:00'),
          end: at('2026-10-05', '22:00'),
        }),
      ],
    });
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.notes?.join(' ')).toContain('também está na sua Agenda às 20:00');
    expect(timeline[0]?.notes?.join(' ')).toContain('horários diferentes');
    expect(busyIntervals(timeline)).toHaveLength(1);
  });

  it('mostra lembrete antigo marcado na Agenda como lembrete, sem ocupar horário', () => {
    const timeline = buildTimeline({
      from: '2026-10-05',
      to: '2026-10-05',
      now,
      agenda: buildAgenda([], now),
      events: [
        event({
          id: 'uvv123',
          title: 'AOP 03 | Aspectos Legais da TI',
          start: at('2026-10-05', '12:00'),
          end: at('2026-10-05', '12:10'),
          telegramReminder: true,
          urgent: true,
        }),
      ],
    });
    expect(timeline).toEqual([
      expect.objectContaining({
        kind: 'lembrete',
        start: '12:00',
        notes: ['lembrete urgente que você marcou na Agenda pelo Telegram'],
      }),
    ]);
    expect(timeline[0]?.end).toBeUndefined();
    expect(busyIntervals(timeline)).toHaveLength(0);
  });
});

describe('prioridades e alertas', () => {
  it('prioriza prova próxima e explica o motivo', () => {
    const later = item({
      title: 'Lista de exercícios 3',
      officialDeadline: '2026-10-12T23:59:00',
      metadata: { origin: 'EAD' },
    });
    const priorities = prioritize(buildAgenda([later, exam()], now), now);
    expect(priorities[0]?.item.category).toBe('prova');
    expect(priorities[0]?.reasons[0]).toContain('prova em 3 dias');
  });

  it('avisa entrega vencendo, prova sem estudo marcado, entregas no mesmo dia e conflito de horário', () => {
    const tomorrow = item({ officialDeadline: '2026-10-03T23:59:00' });
    const twin = item({
      title: 'Trabalho de Redes',
      discipline: 'Redes',
      officialDeadline: '2026-10-03T18:00:00',
      metadata: { origin: 'EAD' },
    });
    const prova = exam({ officialDate: '2026-10-04' });
    const agenda = buildAgenda([tomorrow, twin, prova], now);
    const insights = computeInsights({
      agenda,
      now,
      events: [
        event({
          id: 'a',
          title: 'Reunião',
          start: at('2026-10-03', '10:00'),
          end: at('2026-10-03', '11:00'),
        }),
        event({
          id: 'b',
          title: 'Dentista',
          start: at('2026-10-03', '10:30'),
          end: at('2026-10-03', '11:30'),
        }),
      ],
    });
    const kinds = insights.map((insight) => insight.kind);
    expect(kinds).toContain('due_soon');
    expect(kinds).toContain('exam_without_study');
    expect(kinds).toContain('same_day');
    expect(kinds).toContain('overlap');
    expect(
      insights.filter((insight) => insight.kind === 'due_soon').map((insight) => insight.text),
    ).toContain('AOP 03 — Aspectos Legais vence amanhã às 23:59 e ainda está como pendente.');

    const studied = computeInsights({
      agenda,
      now,
      events: [
        event({
          id: 'c',
          title: '📚 Estudar Linguagens Formais',
          start: at('2026-10-03', '14:00'),
          end: at('2026-10-03', '16:00'),
        }),
      ],
    });
    expect(studied.map((insight) => insight.kind)).not.toContain('exam_without_study');
  });
});

describe('horários livres', () => {
  it('desconta compromissos com folga e ignora o que já passou', () => {
    const slots = freeSlots({
      from: '2026-10-02',
      to: '2026-10-03',
      now,
      busy: [{ start: at('2026-10-03', '10:00'), end: at('2026-10-03', '12:00') }],
      dayEnd: '18:00',
    });
    expect(slots).toEqual([
      { date: '2026-10-02', start: '12:00', end: '18:00', minutes: 360 },
      { date: '2026-10-03', start: '08:00', end: '09:50', minutes: 110 },
      { date: '2026-10-03', start: '12:10', end: '18:00', minutes: 350 },
    ]);
  });
});

describe('memória', () => {
  it('atualiza o mesmo assunto em vez de duplicar e valida horários', () => {
    const first = buildMemoryFact(
      { category: 'aula', subject: 'Cálculo', content: 'seg 19h' },
      [],
      now,
    );
    const second = buildMemoryFact(
      { category: 'aula', subject: 'cálculo ', content: 'ter 19h' },
      [first],
      now,
    );
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(() =>
      buildMemoryFact(
        { category: 'aula', subject: 'X', content: 'y', startTime: '25:00' },
        [],
        now,
      ),
    ).toThrow('Horário inválido');
    expect(memoryContext([second])).toContain('aula · cálculo: ter 19h');
  });
});
