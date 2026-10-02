import { describe, expect, it } from 'vitest';
import { buildAgenda } from '../../src/agenda/agenda.js';
import { itemSignature, planNotifications } from '../../src/bot/notifications.js';
import type { AcademicItem } from '../../src/models/academic-item.js';
import type { NotificationLogEntry } from '../../src/models/bot.js';
import { exam, item, now } from './fixtures.js';

function plan(items: AcademicItem[], log: NotificationLogEntry[], newIds: string[] = [], at = now) {
  return planNotifications({
    agenda: buildAgenda(items, at),
    items,
    log,
    newItemIds: new Set(newIds),
    now: at,
  });
}

function logFor(items: AcademicItem[], at = now): NotificationLogEntry[] {
  return plan(
    items,
    [{ itemId: 'seed', signature: '', level: 'none', lastNotifiedAt: '' }],
    [],
    at,
  ).log.map((entry) => ({ ...entry }));
}

describe('notificações sem repetição', () => {
  const aop = item();

  it('na primeira execução registra tudo em silêncio, exceto o que acabou de surgir', () => {
    const fresh = item({
      title: 'Atividade Online Pontuada 04',
      officialDeadline: '2026-10-19T23:59:00',
    });
    const result = plan([aop, fresh], [], [fresh.id]);
    expect(result.notifications.map((notification) => notification.item.id)).toEqual([fresh.id]);
    expect(result.log.map((entry) => entry.itemId).sort()).toEqual([aop.id, fresh.id].sort());
  });

  it('não avisa de novo quando nada mudou', () => {
    const log = logFor([aop]);
    expect(plan([aop], log).notifications).toEqual([]);
  });

  it('avisa quando o prazo muda, informando o anterior', () => {
    const log = logFor([aop]);
    const moved = { ...aop, officialDeadline: '2026-10-15T23:59:00' };
    const [notification] = plan([moved], log).notifications;
    expect(notification).toMatchObject({ reason: 'date', previousDue: '2026-10-13T23:59:00' });
  });

  it('avisa uma vez quando o prazo fica perto, outra no dia e outra se atrasar', () => {
    let log = logFor([aop]);
    const threeDaysBefore = new Date('2026-10-10T15:00:00Z');
    const high = plan([aop], log, [], threeDaysBefore);
    expect(high.notifications[0]?.reason).toBe('urgent');
    log = high.log;
    expect(plan([aop], log, [], threeDaysBefore).notifications).toEqual([]);
    const dueDay = new Date('2026-10-13T15:00:00Z');
    const critical = plan([aop], log, [], dueDay);
    expect(critical.notifications[0]?.reason).toBe('urgent');
    const overdue = plan([aop], critical.log, [], new Date('2026-10-14T15:00:00Z'));
    expect(overdue.notifications[0]?.reason).toBe('urgent');
  });

  it('avisa atualização de conteúdo em posts do professor', () => {
    const post = item({
      metadata: { origin: 'CLASS_POST' },
      title: 'Trabalho do 1º bimestre',
      description: 'Grupos de até 4 pessoas.',
      officialDeadline: '2026-10-19T23:59:00',
    });
    const log = logFor([post]);
    const edited = { ...post, description: 'Grupos de até 4 pessoas. Apresentação no lab 8.' };
    expect(plan([edited], log).notifications[0]?.reason).toBe('changed');
  });

  it('não alerta 2ª chamada/final nem itens concluídos, e avisa comunicados novos', () => {
    const secondCall = exam({
      title: 'Prova de 2ª chamada — Linguagens Formais e Autômatos',
      officialDate: '2026-11-30',
      metadata: { origin: 'MESSAGE', assessment: 'SECOND_CALL' },
    });
    const done = item({ status: 'DONE' });
    const notice = item({
      type: 'NOTICE',
      title: 'Aula cancelada',
      metadata: { origin: 'MESSAGE' },
    });
    const result = plan(
      [secondCall, done, notice],
      [{ itemId: 'x', signature: '', level: 'none', lastNotifiedAt: '' }],
      [secondCall.id, done.id, notice.id],
    );
    expect(result.notifications.map((notification) => notification.reason)).toEqual(['notice']);
  });

  it('a assinatura guarda o prazo para saber a data anterior', () => {
    const entry = buildAgenda([aop], now).tasks[0];
    if (!entry) throw new Error('entrada esperada');
    expect(itemSignature(entry)).toMatch(/^2026-10-13T23:59:00#[0-9a-f]{8}$/);
  });
});
