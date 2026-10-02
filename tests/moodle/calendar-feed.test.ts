import { describe, expect, it, vi } from 'vitest';
import {
  collectMoodleCalendar,
  parseMoodleCalendar,
  reconcileEadCalendar,
} from '../../src/moodle/calendar-feed.js';

const fixture = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:activity-42@uvv\r
DTSTART:20261005T235900\r
SUMMARY:Entrega da AOP\r
DESCRIPTION:Curso: Empreendedorismo e Negócios\\nEnvie o arquivo final\r
URL:https://saladeaula.ead.uvv.br/mod/assign/view.php?id=42\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:notice-1@uvv\r
DTSTART;VALUE=DATE:20261008\r
SUMMARY:Encontro síncrono\r
DESCRIPTION:Aula online\r
END:VEVENT\r
END:VCALENDAR`;

describe('calendário EAD', () => {
  it('converte atividades em tarefas com prazo e link oficiais', () => {
    const items = parseMoodleCalendar(fixture);
    expect(items[0]).toMatchObject({
      externalId: 'ead-calendar:activity-42@uvv',
      discipline: 'Empreendedorismo e Negócios',
      title: 'Entrega da AOP',
      type: 'AOP',
      officialDeadline: '2026-10-05T23:59:00',
      sourceUrl: 'https://saladeaula.ead.uvv.br/mod/assign/view.php?id=42',
      status: 'TODO',
    });
    expect(items[1]).toMatchObject({
      title: 'Encontro síncrono',
      officialDate: '2026-10-08',
      status: 'WAITING',
    });
  });

  it('trata a abertura de uma atividade como contexto, não como prazo', () => {
    const [opening] = parseMoodleCalendar(`BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
UID:open-1@uvv\r
DTSTART:20261006T030000Z\r
SUMMARY:Início de Atividade Online Pontuada 03\r
DESCRIPTION:Atividade online pontuada\r
CATEGORIES:dcp_aspLegTecInf\r
END:VEVENT\r
END:VCALENDAR`);
    expect(opening?.officialDeadline).toBeUndefined();
    expect(opening?.metadata).toMatchObject({ contextOnly: 'true', calendarPhase: 'OPEN' });
  });

  it('une o término do calendário à atividade do AVA e usa o nome da disciplina', () => {
    const activity = {
      externalId: 'ead:/mod/quiz/view.php:8603',
      source: 'PORTAL' as const,
      sourceUrl: 'https://saladeaula.ead.uvv.br/mod/quiz/view.php?id=8603',
      discipline: 'Aspectos Legais da Tecnologia da Informação',
      title: 'Atividade Online Pontuada 03',
      description: 'Fecha: terça-feira, 13 out. 2026, 23:59',
      type: 'ASSIGNMENT' as const,
      officialDeadline: '2026-10-13T23:59:00',
      metadata: { origin: 'EAD' },
    };
    const closing = {
      externalId: 'ead-calendar:close-3@uvv',
      source: 'PORTAL' as const,
      sourceUrl: 'https://saladeaula.ead.uvv.br/calendar/view.php',
      discipline: 'dcp_aspLegTecInf',
      title: 'Término de Atividade Online Pontuada 03',
      description: 'Atividade online pontuada',
      type: 'ASSIGNMENT' as const,
      officialDeadline: '2026-10-14T02:59:00Z',
      metadata: { origin: 'EAD_CALENDAR' },
    };
    const other = {
      ...closing,
      externalId: 'ead-calendar:close-9@uvv',
      title: 'Término de Fórum avaliativo',
      officialDeadline: '2026-10-20T02:59:00Z',
    };
    const [, reconciled, untouched] = reconcileEadCalendar([activity, closing, other]);
    expect(reconciled?.metadata).toMatchObject({
      contextOnly: 'true',
      duplicateOf: 'ead:/mod/quiz/view.php:8603',
    });
    expect(reconciled?.discipline).toBe('Aspectos Legais da Tecnologia da Informação');
    expect(untouched?.metadata?.contextOnly).toBeUndefined();
    expect(untouched?.discipline).toBe('Aspectos Legais da Tecnologia da Informação');
  });

  it('junta início, término e atividade do AVA em uma única atividade', () => {
    const activity = {
      externalId: 'ead:/mod/quiz/view.php:8603',
      source: 'PORTAL' as const,
      sourceUrl: 'https://saladeaula.ead.uvv.br/mod/quiz/view.php?id=8603',
      discipline: 'Aspectos Legais da Tecnologia da Informação',
      title: 'Atividade Online Pontuada 03',
      description: 'Fecha: terça-feira, 13 out. 2026, 23:59',
      type: 'ASSIGNMENT' as const,
      officialDeadline: '2026-10-13T23:59:00',
      metadata: { origin: 'EAD' },
    };
    const events = parseMoodleCalendar(`BEGIN:VCALENDAR\r
BEGIN:VEVENT\r
UID:open-3@uvv\r
DTSTART:20261006T030000Z\r
SUMMARY:Início de Atividade Online Pontuada 03\r
DESCRIPTION:Essa é uma atividade online pontuada do tipo QUESTIONÁRIO E VALE 2,0 PONTOS.\r
CATEGORIES:dcp_aspLegTecInf\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:close-3@uvv\r
DTSTART:20261014T025900Z\r
SUMMARY:Término de Atividade Online Pontuada 03\r
DESCRIPTION:Essa é uma atividade online pontuada do tipo QUESTIONÁRIO E VALE 2,0 PONTOS.\r
CATEGORIES:dcp_aspLegTecInf\r
END:VEVENT\r
END:VCALENDAR`);
    const [merged, opening, closing] = reconcileEadCalendar([activity, ...events]);
    expect(merged?.metadata).toMatchObject({ opensAt: '2026-10-06T03:00:00.000Z', points: '2' });
    expect(opening?.metadata?.contextOnly).toBe('true');
    expect(closing?.metadata?.contextOnly).toBe('true');
    expect(opening?.discipline).toBe('Aspectos Legais da Tecnologia da Informação');
  });

  it('valida domínio e conteúdo antes de confiar no feed', async () => {
    await expect(collectMoodleCalendar('https://example.com/calendar.ics')).rejects.toThrow(
      /domínio oficial/,
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(fixture, { headers: { 'content-type': 'text/calendar; charset=utf-8' } }),
      );
    await expect(
      collectMoodleCalendar('https://saladeaula.ead.uvv.br/calendar/export_execute.php', fetcher),
    ).resolves.toHaveLength(2);
  });
});
