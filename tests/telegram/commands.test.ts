import { describe, expect, it } from 'vitest';
import { parseTelegramAction } from '../../src/telegram/commands.js';

describe('comandos e respostas Telegram', () => {
  it.each([
    ['/feito UVV-ABC123', 'DONE'],
    ['/fazendo UVV-ABC123', 'IN_PROGRESS'],
    ['/pendente UVV-ABC123', 'TODO'],
    ['/ignorar UVV-ABC123', 'IGNORED'],
  ] as const)('interpreta %s', (text, status) => {
    expect(parseTelegramAction(text)).toEqual({ kind: 'SET_STATUS', itemId: 'UVV-ABC123', status });
  });

  it('interpreta consulta de status', () => {
    expect(parseTelegramAction('/status UVV-ABC123')).toEqual({
      kind: 'GET_STATUS',
      itemId: 'UVV-ABC123',
    });
  });

  it.each([
    ['já fiz UVV-ABC123', 'DONE'],
    ['estou fazendo UVV-ABC123', 'IN_PROGRESS'],
    ['ainda não fiz UVV-ABC123', 'TODO'],
  ] as const)('interpreta linguagem natural: %s', (text, status) => {
    expect(parseTelegramAction(text)).toEqual({ kind: 'SET_STATUS', itemId: 'UVV-ABC123', status });
  });

  it('usa o ID da mensagem respondida', () => {
    expect(parseTelegramAction('terminei', 'Tarefa UVV-ABC123')).toEqual({
      kind: 'SET_STATUS',
      itemId: 'UVV-ABC123',
      status: 'DONE',
    });
  });

  it('não adivinha a tarefa sem ID', () => {
    expect(parseTelegramAction('já fiz')).toMatchObject({ kind: 'UNKNOWN' });
  });

  it.each(['oi', 'obrigado', 'teste'])('ignora mensagem comum: %s', (text) => {
    expect(parseTelegramAction(text)).toEqual({ kind: 'IGNORE' });
  });

  it.each(['/start', '/ajuda'])('mostra ajuda para %s', (text) => {
    expect(parseTelegramAction(text)).toEqual({ kind: 'HELP' });
  });
});
