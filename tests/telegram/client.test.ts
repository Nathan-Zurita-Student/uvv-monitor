import { describe, expect, it } from 'vitest';
import { splitTelegramMessage } from '../../src/telegram/client.js';

describe('cliente Telegram', () => {
  it('divide mensagens acima do limite sem perder conteúdo', () => {
    const text = Array.from({ length: 900 }, (_, index) => `linha-${String(index)}`).join('\n');
    const chunks = splitTelegramMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
    expect(chunks.join('\n')).toBe(text);
  });
});
