import { describe, expect, it } from 'vitest';
import {
  isWeeklyReviewRun,
  scheduledSlots,
  verificationWindow,
} from '../../src/scheduler/windows.js';

describe('janelas no timezone America/Sao_Paulo', () => {
  it('mantém os nove horários na ordem configurada', () => {
    expect(scheduledSlots).toEqual([
      '10:00',
      '12:00',
      '14:00',
      '16:00',
      '18:00',
      '20:00',
      '21:00',
      '22:00',
      '23:00',
    ]);
  });

  it('10h busca desde 23h do dia anterior', () => {
    const window = verificationWindow(new Date('2026-09-30T13:00:00Z'), '10:00');
    expect(window.from.toISOString()).toBe('2026-09-30T02:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-09-30T13:00:00.000Z');
  });

  it('cada horário seguinte busca desde o anterior', () => {
    const noon = verificationWindow(new Date('2026-09-30T15:00:00Z'), '12:00');
    expect(noon.from.toISOString()).toBe('2026-09-30T13:00:00.000Z');
    const evening = verificationWindow(new Date('2026-09-30T23:00:00Z'), '20:00');
    expect(evening.from.toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });

  it('faz a revisão semanal somente às 20h de quarta e domingo locais', () => {
    expect(isWeeklyReviewRun(new Date('2026-09-30T23:00:00Z'), '20:00')).toBe(true);
    expect(isWeeklyReviewRun(new Date('2026-09-27T23:00:00Z'), '20:00')).toBe(true);
    expect(isWeeklyReviewRun(new Date('2026-10-01T00:00:00Z'), '21:00')).toBe(false);
    expect(isWeeklyReviewRun(new Date('2026-10-01T23:00:00Z'), '20:00')).toBe(false);
  });
});
