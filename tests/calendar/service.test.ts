import { describe, expect, it, vi } from 'vitest';
import type { AcademicItem } from '../../src/models/academic-item.js';
import {
  buildCalendarEvent,
  isCalendarSyncCandidate,
  syncCalendarEvent,
} from '../../src/calendar/service.js';
import type {
  CalendarEventInput,
  CalendarEventRecord,
  CalendarGateway,
} from '../../src/calendar/types.js';

const item: AcademicItem = {
  id: 'UVV-ABC123',
  externalId: 'calendar:859084',
  source: 'PORTAL',
  sourceUrl: 'https://aluno.uvv.br/Calendario/Aluno/id',
  discipline: 'Cálculo Numérico',
  title: 'AOP 1',
  description: 'Entregar exercícios 1–10',
  type: 'AOP',
  officialDeadline: '2026-10-02T23:59:00',
  firstSeenAt: '2026-09-30T12:00:00-03:00',
  lastSeenAt: '2026-09-30T12:00:00-03:00',
  contentHash: 'hash-1',
  status: 'TODO',
  urgency: 'NEXT_72_HOURS',
};

function gateway(events: ReturnType<typeof buildCalendarEvent>[] = []) {
  const list = vi.fn((): Promise<CalendarEventRecord[]> =>
    Promise.resolve(
      events
        .filter((event): event is CalendarEventInput => Boolean(event))
        .map((event, index) => ({ ...event, id: `event-${String(index)}` })),
    ),
  );
  const insert = vi.fn((event: CalendarEventInput): Promise<CalendarEventRecord> =>
    Promise.resolve({ ...event, id: 'created-id' }),
  );
  const update = vi.fn((id: string, event: CalendarEventInput): Promise<CalendarEventRecord> =>
    Promise.resolve({ ...event, id }),
  );
  const value: CalendarGateway = { list, insert, update };
  return { value, insert, update };
}

describe('sincronização com Google Calendar', () => {
  it('monta evento com prefixo, origem e ID privado', () => {
    const event = buildCalendarEvent(item, '2026-09-30T12:00:00-03:00');
    expect(event).toMatchObject({
      summary: '[UVV] AOP — Cálculo Numérico',
      extendedProperties: { private: { uvvItemId: 'UVV-ABC123' } },
    });
    expect(event?.description).toContain('Prazo oficial: 2026-10-02T23:59:00');
  });

  it('não cria evento sem data confirmada', async () => {
    const undated: AcademicItem = { ...item };
    delete undated.officialDeadline;
    const result = await syncCalendarEvent(gateway().value, undated, false);
    expect(result.action).toBe('SKIPPED_UNCONFIRMED');
  });

  it('respeita DRY_RUN', async () => {
    const fake = gateway();
    const result = await syncCalendarEvent(fake.value, item, true);
    expect(result.action).toBe('WOULD_CREATE');
    expect(fake.insert).not.toHaveBeenCalled();
  });

  it('cria evento quando não há equivalente', async () => {
    const fake = gateway();
    await expect(syncCalendarEvent(fake.value, item, false)).resolves.toEqual({
      action: 'CREATED',
      eventId: 'created-id',
    });
  });

  it('não duplica evento equivalente', async () => {
    const desired = buildCalendarEvent(item, '2026-09-30T12:00:00-03:00');
    const fake = gateway([desired]);
    await expect(
      syncCalendarEvent(fake.value, item, false, '2026-09-30T12:00:00-03:00'),
    ).resolves.toEqual({
      action: 'UNCHANGED',
      eventId: 'event-0',
    });
    expect(fake.insert).not.toHaveBeenCalled();
  });

  it('não assume controle de evento pessoal visualmente equivalente', async () => {
    const desired = buildCalendarEvent(item, '2026-09-30T12:00:00-03:00');
    expect(desired).toBeDefined();
    const personalEvent = {
      ...desired!,
      extendedProperties: { private: {} },
    };
    const fake = gateway([personalEvent]);
    await expect(syncCalendarEvent(fake.value, item, false)).resolves.toEqual({
      action: 'SKIPPED_EQUIVALENT',
    });
    expect(fake.insert).not.toHaveBeenCalled();
    expect(fake.update).not.toHaveBeenCalled();
  });

  it('seleciona somente tarefas futuras, oficiais e abertas para sincronização', () => {
    expect(isCalendarSyncCandidate(item)).toBe(true);
    expect(isCalendarSyncCandidate({ ...item, status: 'DONE' })).toBe(false);
    expect(isCalendarSyncCandidate({ ...item, urgency: 'OVERDUE' })).toBe(false);
    expect(
      isCalendarSyncCandidate({ ...item, status: 'NEEDS_CONFIRMATION', urgency: 'FUTURE' }),
    ).toBe(false);
    expect(isCalendarSyncCandidate({ ...item, type: 'CLASS', urgency: 'FUTURE' })).toBe(false);
  });
});
