import { describe, expect, it } from 'vitest';
import { dueSlot } from '../../src/gas/collector-dispatch.js';
import { recentlyCollected } from '../../src/scheduler/orchestrator.js';

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

  it('o agendamento atrasado do GitHub não repete uma coleta recente', () => {
    const now = new Date('2026-10-05T18:30:00Z');
    expect(recentlyCollected('2026-10-05T15:05:00Z', now)).toBe(false);
    expect(recentlyCollected('2026-10-05T16:05:00Z', now)).toBe(true);
    expect(recentlyCollected(undefined, now)).toBe(false);
  });
});
