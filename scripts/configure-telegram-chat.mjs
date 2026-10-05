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
    // Opcional: token do GitHub (só Actions deste repositório) para o bot disparar a coleta.
    'MONITOR_DISPATCH_TOKEN',
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
// Versões anteriores usam HtmlService, que escapa o JSON dentro de userHtml.
const confirmation = body
  .replace(/\\x([\da-f]{2})|\\u([\da-f]{4})/gi, (_, hex, unicode) =>
    String.fromCharCode(parseInt(hex || unicode, 16)),
  )
  .replace(/&quot;|&#34;/gi, '"')
  .replace(/\\"/g, '"');
if (!configured.ok || !/"configured"\s*:\s*true/.test(confirmation)) {
  console.log(
    JSON.stringify({
      status: configured.status,
      contentType: configured.headers.get('content-type'),
      hasConfigurationMarker: /configured|openaiKeyConfigured/.test(body),
      isGoogleError: /error|Exception|erro|exceção/i.test(body),
      requiresLogin: /accounts\.google\.com|ServiceLogin/.test(body),
    }),
  );
  throw new Error(
    'O Apps Script ainda não confirmou a configuração. Publique a versão atual de Bot.gs.',
  );
}
console.log('Configuração Google sincronizada com o bot.');
// Confere a autorização real sem criar eventos nem imprimir conteúdo da agenda.
const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }),
});
const token = await tokenResponse.json();
if (!tokenResponse.ok || !token.access_token)
  throw new Error('A autorização Google existente foi recusada.');
const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
const calendar = await fetch(
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=1`,
  {
    headers: { authorization: `Bearer ${token.access_token}` },
  },
);
if (!calendar.ok) throw new Error(`A agenda recusou a verificação (HTTP ${calendar.status}).`);
console.log('Acesso à agenda verificado com a autorização existente.');
console.log(
  /"openaiKeyConfigured"\s*:\s*true/.test(confirmation)
    ? 'Chave GPT cadastrada. Conversa pronta para teste.'
    : '::warning::Falta cadastrar OPENAI_API_KEY no GitHub ou nas propriedades do Apps Script.',
);
console.log(
  /"dispatchConfigured"\s*:\s*true/.test(confirmation)
    ? 'Disparo das coletas pelo bot ativado (12h, 17h, 21h e "Verificar Portal agora").'
    : '::warning::Falta MONITOR_DISPATCH_TOKEN: as coletas ficam só no agendamento do GitHub.',
);
