import { describe, expect, it } from 'vitest';
import { toAgendaEntry } from '../../src/agenda/agenda.js';
import { decodeCallback, encodeCallback, type CallbackAction } from '../../src/bot/callbacks.js';
import {
  describeReminder,
  parseReminderText,
  reminderChoices,
  reminderTime,
} from '../../src/bot/reminders.js';
import { item, now } from './fixtures.js';

const local = (date: Date | undefined) =>
  date?.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

describe('callback_data', () => {
  const actions: CallbackAction[] = [
    {
      type: 'status',
      itemId: 'UVV-055A63',
      status: 'DONE',
      undo: false,
      screen: { kind: 'card', context: 'new' },
    },
    {
      type: 'status',
      itemId: 'UVV-055A63',
      status: 'TODO',
      undo: true,
      screen: { kind: 'pager', batchId: 'ab12cd34', index: 11 },
    },
    {
      type: 'remind',
      itemId: 'UVV-055A63',
      option: 'daybefore',
      screen: { kind: 'detail', from: 'tasks' },
    },
    { type: 'remindMenu', itemId: 'UVV-055A63', screen: { kind: 'card', context: 'reminder' } },
    { type: 'item', itemId: 'UVV-055A63', screen: { kind: 'detail', from: 'late' } },
    { type: 'view', view: 'home', refresh: true },
    { type: 'page', batchId: 'ab12cd34', index: -1 },
    { type: 'noop' },
  ];

  it('codifica e decodifica todas as ações dentro do limite do Telegram', () => {
    for (const action of actions) {
      const encoded = encodeCallback(action);
      expect(encoded.length).toBeLessThanOrEqual(64);
      expect(decodeCallback(encoded)).toEqual(action);
    }
  });

  it('entende os botões antigos e rejeita dados inválidos', () => {
    expect(decodeCallback('task:UVV-ABC123:completed')).toEqual({
      type: 'legacy',
      itemId: 'UVV-ABC123',
      status: 'DONE',
    });
    expect(decodeCallback('s|nao-e-id|D|c.n')).toBeUndefined();
    expect(decodeCallback('qualquer coisa')).toBeUndefined();
  });
});

describe('lembretes', () => {
  const entry = toAgendaEntry(item(), now);

  it('calcula as opções rápidas', () => {
    expect(local(reminderTime('30m', entry, now))).toBe('02/10/2026, 12:30:00');
    expect(local(reminderTime('night', entry, now))).toBe('02/10/2026, 20:00:00');
    expect(local(reminderTime('tomorrow', entry, now))).toBe('03/10/2026, 09:00:00');
    expect(local(reminderTime('daybefore', entry, now))).toBe('12/10/2026, 09:00:00');
  });

  it('esconde opções que já passaram', () => {
    const late = new Date('2026-10-02T23:00:00Z'); // 20h
    const options = reminderChoices(
      toAgendaEntry(item({ officialDeadline: '2026-10-03T08:00:00' }), late),
      late,
    ).map((choice) => choice.option);
    expect(options).not.toContain('night');
    expect(options).not.toContain('daybefore');
    expect(options).toContain('custom');
  });

  it('entende horários escritos livremente', () => {
    expect(local(parseReminderText('18:30', now))).toBe('02/10/2026, 18:30:00');
    expect(local(parseReminderText('20h', now))).toBe('02/10/2026, 20:00:00');
    expect(local(parseReminderText('9h', now))).toBe('03/10/2026, 09:00:00');
    expect(local(parseReminderText('amanhã 9h', now))).toBe('03/10/2026, 09:00:00');
    expect(local(parseReminderText('15/10 14h', now))).toBe('15/10/2026, 14:00:00');
    expect(local(parseReminderText('em 2 horas', now))).toBe('02/10/2026, 14:00:00');
    expect(local(parseReminderText('daqui a 40 min', now))).toBe('02/10/2026, 12:40:00');
    expect(parseReminderText('quando der', now)).toBeUndefined();
    expect(parseReminderText('31/02 25h', now)).toBeUndefined();
  });

  it('descreve o lembrete de forma natural', () => {
    expect(describeReminder(new Date('2026-10-02T23:00:00Z'), now)).toBe('hoje às 20:00');
    expect(describeReminder(new Date('2026-10-03T12:00:00Z'), now)).toBe('amanhã às 09:00');
    expect(describeReminder(new Date('2026-10-07T17:00:00Z'), now)).toBe('qua, 07/10 às 14:00');
  });
});
