/**
 * O webhook do Apps Script responde aos botões a partir de uma cópia da planilha em cache. Ao fim
 * de cada coleta, o monitor pede uma cópia nova pela mesma URL registrada no Telegram (que já
 * leva o segredo do webhook).
 */
export async function refreshWebhookCache(
  webhookUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const url = new URL(webhookUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com') return false;
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uvv: 'refresh' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`O webhook respondeu HTTP ${String(response.status)}.`);
  return true;
}
