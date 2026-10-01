import { describe, expect, it, vi } from 'vitest';
import { collectMoodleCalendar, parseMoodleCalendar } from '../../src/moodle/calendar-feed.js';

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
