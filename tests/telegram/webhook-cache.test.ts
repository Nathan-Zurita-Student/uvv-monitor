import { describe, expect, it, vi } from 'vitest';
import { refreshWebhookCache } from '../../src/telegram/webhook-cache.js';

describe('conclusão da coleta no Apps Script', () => {
  it('avisa a URL do webhook para atualizar a cópia e liberar o resumo', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const url = 'https://script.google.com/macros/s/abc/exec?secret=s3';
    await expect(refreshWebhookCache(url, fetcher)).resolves.toBe(true);
    const [target, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe(url);
    expect(init).toMatchObject({ method: 'POST', body: '{"uvv":"refresh"}' });
  });

  it('ignora webhooks fora do Apps Script e avisa falhas', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('erro', { status: 500 }));
    await expect(refreshWebhookCache('https://example.com/hook', fetcher)).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      refreshWebhookCache('https://script.google.com/macros/s/abc/exec', fetcher),
    ).rejects.toThrow('HTTP 500');
  });
});
