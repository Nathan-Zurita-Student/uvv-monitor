import { describe, expect, it } from 'vitest';
import {
  dueSlot,
  manualDispatchCompleted,
  slotForManualDispatch,
} from '../../src/gas/collector-dispatch.js';
import { collectionCoversDigest } from '../../src/gas/daily-digest.js';
import { slotAlreadyCollected } from '../../src/scheduler/orchestrator.js';

describe('coleta disparada pelo Apps Script', () => {
  it('só libera o resumo depois de uma coleta da janela atual', () => {
    const now = new Date('2026-10-05T12:00:00-03:00');
    expect(collectionCoversDigest(undefined, undefined, now, '12:00')).toBe(false);
    expect(
      collectionCoversDigest('2026-10-04T23:40:00Z', '2026-10-04T23:50:00Z', now, '12:00'),
    ).toBe(false);
    expect(
      collectionCoversDigest('2026-10-05T14:29:59Z', '2026-10-05T14:50:00Z', now, '12:00'),
    ).toBe(false);
    expect(
      collectionCoversDigest('2026-10-05T14:30:00Z', '2026-10-05T14:50:00Z', now, '12:00'),
    ).toBe(true);
    expect(
      collectionCoversDigest('2026-10-05T14:50:00Z', '2026-10-05T15:01:01Z', now, '12:00'),
    ).toBe(false);
  });

  it('dispara cada horário uma vez, começando vinte minutos antes', () => {
    const at = (time: string) => new Date(`2026-10-05T${time}:00-03:00`);
    expect(dueSlot(at('09:39'), null)).toBeUndefined();
    expect(dueSlot(at('09:40'), null)).toBe('10:00');
    expect(dueSlot(at('10:03'), null)).toBe('10:00');
    expect(dueSlot(at('10:03'), '2026-10-05 10:00')).toBeUndefined();
    expect(dueSlot(at('10:03'), '2026-10-04 10:00')).toBe('10:00');
    expect(dueSlot(at('10:50'), null)).toBeUndefined();
    expect(dueSlot(at('13:40'), '2026-10-05 12:00')).toBe('14:00');
    expect(dueSlot(at('20:40'), '2026-10-05 20:00')).toBe('21:00');
    expect(dueSlot(at('22:40'), '2026-10-05 22:00')).toBe('23:00');
  });

  it('usa o próximo horário lógico em uma coleta manual', () => {
    const at = (time: string) => new Date(`2026-10-05T${time}:00-03:00`);
    expect(slotForManualDispatch(at('09:15'))).toBe('10:00');
    expect(slotForManualDispatch(at('17:00'))).toBe('18:00');
    expect(slotForManualDispatch(at('23:30'))).toBe('23:00');
  });

  it('só confirma uma coleta manual que terminou depois do pedido', () => {
    const request = { requestedAt: '2026-10-05T17:36:30Z', slot: '16:00' as const };
    expect(manualDispatchCompleted(request, '2026-10-05T17:36:51Z', '2026-10-05T17:41:30Z')).toBe(
      true,
    );
    expect(manualDispatchCompleted(request, '2026-10-05T17:18:51Z', '2026-10-05T17:22:45Z')).toBe(
      false,
    );
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
    // As 18h chegam às 21:40 depois de uma coleta das 12h atrasada (15:35): rodam.
    expect(
      slotAlreadyCollected(
        at('2026-10-05T15:35:00').toISOString(),
        '18:00',
        at('2026-10-05T21:40:00'),
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
