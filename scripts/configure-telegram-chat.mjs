// Executado somente no runner/local com secrets; não escreve nem imprime valores de credenciais.
const required = [
  'TELEGRAM_BOT_TOKEN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Secret ausente: ${name}`);
}
const response = await fetch(
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`,
);
const info = await response.json();
if (!response.ok || !info.ok) throw new Error('Não consegui consultar o webhook do Telegram.');
const url = new URL(info.result.url);
if (
  url.protocol !== 'https:' ||
  url.hostname !== 'script.google.com' ||
  !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname) ||
  !url.searchParams.get('secret')
) {
  throw new Error('O webhook precisa apontar para o Apps Script autenticado do monitor.');
}
const configuration = Object.fromEntries(
  [
    'OPENAI_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN',
    'GOOGLE_CALENDAR_ID',
  ]
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]]),
);
const configured = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ uvv: 'configure_chat', configuration }),
  signal: AbortSignal.timeout(60000),
});
const body = await configured.text();
if (!configured.ok || !/"configured"\s*:\s*true/.test(body))
  throw new Error(
    'O Apps Script ainda não confirmou a configuração. Publique a versão atual de Bot.gs.',
  );
console.log('Configuração Google sincronizada com o bot.');
console.log(
  /"openaiKeyConfigured"\s*:\s*true/.test(body)
    ? 'Chave GPT cadastrada. Conversa pronta para teste.'
    : 'Falta cadastrar OPENAI_API_KEY no GitHub ou nas propriedades do Apps Script.',
);
