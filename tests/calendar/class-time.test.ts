import { describe, expect, it } from 'vitest';
import { buildCalendarEvent, syncCalendarEvent } from '../../src/calendar/service.js';
import type { CalendarEventInput, CalendarGateway } from '../../src/calendar/types.js';
import type { AcademicItem } from '../../src/models/academic-item.js';
import type { ClassSlot } from '../../src/models/class-schedule.js';

const games: ClassSlot = {
  code: 'GAME',
  discipline: 'Desenvolvimento de Games',
  weekday: 3,
  startTime: '19:10',
  endTime: '20:50',
  online: false,
  period: '2026/2',
};
const mobile: ClassSlot = { ...games, code: 'DESENV', discipline: 'Desenvolvimento Mobile' };

const presentation: AcademicItem = {
  id: 'UVV-TRAB01',
  externalId: 'post:Tvi7uh1DVns=',
  source: 'PORTAL',
  sourceUrl: 'https://aluno.uvv.br/Aluno/Post/Tvi7uh1DVns=',
  discipline: 'Desenvolvimento de Games',
  title: 'Trab 1 Bim: Entrega, apresentação e execução no lab 12 - dia 14/10',
  description: 'Trab 1 Bim: Entrega, apresentação e execução no lab 12 - dia 14/10',
  type: 'ASSIGNMENT',
  officialDeadline: '2026-10-14',
  firstSeenAt: '2026-09-21T12:00:00Z',
  lastSeenAt: '2026-10-05T12:00:00Z',
  contentHash: 'h1',
  status: 'TODO',
  urgency: 'FUTURE',
};

describe('horário provável pela aula', () => {
  it('marca apresentação sem hora no horário da aula da própria disciplina', () => {
    const event = buildCalendarEvent(presentation, '2026-10-05T12:00:00Z', [mobile, games]);
    expect(event?.start).toEqual({
      dateTime: '2026-10-14T19:10:00',
      timeZone: 'America/Sao_Paulo',
    });
    expect(event?.end).toEqual({ dateTime: '2026-10-14T20:50:00', timeZone: 'America/Sao_Paulo' });
    expect(event?.description).toContain('marquei no horário da aula de Desenvolvimento de Games');
  });

  it('mantém o dia inteiro sem aula naquele dia ou para entrega comum', () => {
    expect(buildCalendarEvent(presentation, 'x', [mobile])?.start).toEqual({ date: '2026-10-14' });
    const entrega = { ...presentation, title: 'Lista 3', description: 'Entregar pelo AVA' };
    expect(buildCalendarEvent(entrega, 'x', [games])?.start).toEqual({ date: '2026-10-14' });
  });

  it('não atualiza o evento só porque o Google devolve o horário com fuso', async () => {
    const desired = buildCalendarEvent(presentation, '2026-09-21T12:00:00Z', [games])!;
    const stored: CalendarEventInput & { id: string } = {
      ...desired,
      id: 'evt1',
      start: { dateTime: '2026-10-14T19:10:00-03:00', timeZone: 'America/Sao_Paulo' },
      end: { dateTime: '2026-10-14T20:50:00-03:00', timeZone: 'America/Sao_Paulo' },
    };
    const gateway: CalendarGateway = {
      list: () => Promise.resolve([stored]),
      insert: () => Promise.reject(new Error('não deveria criar')),
      update: () => Promise.reject(new Error('não deveria atualizar')),
    };
    await expect(
      syncCalendarEvent(gateway, presentation, false, '2026-09-21T12:00:00Z', [games]),
    ).resolves.toEqual({ action: 'UNCHANGED', eventId: 'evt1' });
  });
});
