import { describe, expect, it } from 'vitest';
import { isWeeklyReviewRun, verificationWindow } from '../../src/scheduler/windows.js';

describe('janelas no timezone America/Sao_Paulo', () => {
  it('12h busca desde 20h do dia anterior', () => {
    const window = verificationWindow(new Date('2026-09-30T15:00:00Z'), '12:00');
    expect(window.from.toISOString()).toBe('2026-09-29T23:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('17h busca desde 12h local', () => {
    const window = verificationWindow(new Date('2026-09-30T20:00:00Z'), '17:00');
    expect(window.from.toISOString()).toBe('2026-09-30T15:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-09-30T20:00:00.000Z');
  });

  it('reconhece quarta-feira local às 21h mesmo quando UTC já é quinta', () => {
    expect(isWeeklyReviewRun(new Date('2026-10-01T00:00:00Z'), '21:00')).toBe(true);
  });

  it('reconhece domingo local às 21h', () => {
    expect(isWeeklyReviewRun(new Date('2026-09-28T00:00:00Z'), '21:00')).toBe(true);
  });

  it('não gera revisão semanal em outro horário', () => {
    expect(isWeeklyReviewRun(new Date('2026-10-01T00:00:00Z'), '17:00')).toBe(false);
  });

  it('20h é o novo resumo noturno e quarta-feira é calculada no fuso local', () => {
    const date = new Date('2026-09-30T23:00:00Z');
    expect(isWeeklyReviewRun(date, '20:00')).toBe(true);
    expect(verificationWindow(date, '20:00').to.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(isWeeklyReviewRun(new Date('2026-10-01T23:00:00Z'), '20:00')).toBe(false);
  });
});
