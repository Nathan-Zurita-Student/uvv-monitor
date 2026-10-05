import { describe, expect, it } from 'vitest';
import { dueSlot } from '../../src/gas/collector-dispatch.js';
import { slotAlreadyCollected } from '../../src/scheduler/orchestrator.js';

describe('coleta disparada pelo Apps Script', () => {
  it('dispara cada horário uma vez, logo depois da hora', () => {
    const at = (time: string) => new Date(`2026-10-05T${time}:00-03:00`);
    expect(dueSlot(at('11:58'), null)).toBeUndefined();
    expect(dueSlot(at('12:03'), null)).toBe('12:00');
    expect(dueSlot(at('12:03'), '2026-10-05 12:00')).toBeUndefined();
    expect(dueSlot(at('12:03'), '2026-10-04 12:00')).toBe('12:00');
    expect(dueSlot(at('12:55'), null)).toBeUndefined();
    expect(dueSlot(at('17:00'), '2026-10-05 12:00')).toBe('17:00');
    expect(dueSlot(at('21:20'), '2026-10-05 17:00')).toBe('21:00');
  });

  it('o agendamento atrasado do GitHub não repete um horário já coletado', () => {
    const at = (value: string) => new Date(`${value}-03:00`);
    // Disparo do Apps Script às 12:03; a reserva das 12:55 chega às 15:30: ignorada.
    expect(
      slotAlreadyCollected(
        at('2026-10-05T12:09:00').toISOString(),
        '12:00',
        at('2026-10-05T15:30:00'),
      ),
    ).toBe(true);
    // Sem disparo: a última coleta foi na noite anterior, então a reserva roda.
    expect(
      slotAlreadyCollected(
        at('2026-10-04T21:08:00').toISOString(),
        '12:00',
        at('2026-10-05T15:30:00'),
      ),
    ).toBe(false);
    // As 17h chegam às 20:40 depois de uma coleta das 12h atrasada (15:35): rodam.
    expect(
      slotAlreadyCollected(
        at('2026-10-05T15:35:00').toISOString(),
        '17:00',
        at('2026-10-05T20:40:00'),
      ),
    ).toBe(false);
    // As 21h chegam depois da meia-noite: a coleta das 21:05 de ontem conta.
    expect(
      slotAlreadyCollected(
        at('2026-10-05T21:05:00').toISOString(),
        '21:00',
        at('2026-10-06T00:40:00'),
      ),
    ).toBe(true);
    expect(slotAlreadyCollected(undefined, '12:00', at('2026-10-05T15:30:00'))).toBe(false);
  });
});
