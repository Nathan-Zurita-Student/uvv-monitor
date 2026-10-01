import { describe, expect, it } from 'vitest';
import type { AcademicItem } from '../../src/models/academic-item.js';
import {
  buildTaskInlineKeyboard,
  isTrackableTask,
  parseTaskCallback,
  taskCallbackData,
} from '../../src/telegram/task-actions.js';

function item(overrides: Partial<AcademicItem> = {}): AcademicItem {
  return {
    id: 'UVV-ABC123',
    externalId: 'post:1',
    source: 'PORTAL',
    sourceUrl: 'https://aluno.uvv.br/Aluno/Post/1',
    discipline: 'Cálculo',
    title: 'Prova',
    description: 'Avaliação',
    type: 'EXAM',
    officialDate: '2026-09-30',
    firstSeenAt: '2026-09-30T12:00:00-03:00',
    lastSeenAt: '2026-09-30T12:00:00-03:00',
    contentHash: 'hash',
    status: 'TODO',
    urgency: 'TODAY',
    ...overrides,
  };
}

describe('ações inline de tarefas', () => {
  it('gera e interpreta callback com ID persistente', () => {
    const value = taskCallbackData('UVV-ABC123', 'in_progress');
    expect(value).toBe('task:UVV-ABC123:in_progress');
    expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(64);
    expect(parseTaskCallback(value)).toEqual({
      itemId: 'UVV-ABC123',
      status: 'IN_PROGRESS',
      callbackStatus: 'in_progress',
    });
  });

  it.each(['task:UVV-ABC123:admin', 'other:UVV-ABC123:completed', 'task:1:completed', ''])(
    'rejeita callback arbitrário: %s',
    (value) => {
      expect(parseTaskCallback(value)).toBeUndefined();
    },
  );

  it('marca o status atual e cria botão URL sem callback', () => {
    const keyboard = buildTaskInlineKeyboard(item({ status: 'IN_PROGRESS' }));
    expect(keyboard.flat().some((button) => button.text === '🔄 Em andamento ✓')).toBe(true);
    expect(keyboard.at(-1)).toEqual([
      { text: '🔗 Abrir no Portal UVV', url: 'https://aluno.uvv.br/Aluno/Post/1' },
    ]);
  });

  it('gera botões de andamento como links seguros do Apps Script', () => {
    const keyboard = buildTaskInlineKeyboard(item(), {
      actionBaseUrl: 'https://script.google.com/macros/s/deployment/exec',
      actionToken: 'token-unico-da-mensagem',
    });
    const firstButton = keyboard[0]?.[0];
    expect(firstButton?.text).toBe('⏳ Não comecei ✓');
    expect(firstButton).not.toHaveProperty('callback_data');
    if (!firstButton || !('url' in firstButton)) throw new Error('Botão URL não foi criado.');
    const url = new URL(firstButton.url);
    expect(url.searchParams.get('item')).toBe('UVV-ABC123');
    expect(url.searchParams.get('status')).toBe('not_started');
    expect(url.searchParams.get('token')).toBe('token-unico-da-mensagem');
  });

  it('separa tarefa acompanhável de comunicado', () => {
    expect(isTrackableTask(item())).toBe(true);
    expect(isTrackableTask(item({ type: 'NOTICE' }))).toBe(false);
    expect(isTrackableTask(item({ status: 'DONE' }))).toBe(false);
  });
});
