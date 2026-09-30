import { google } from 'googleapis';
import { loadConfig, requireGoogleCredentials } from '../config/env.js';
import { createGoogleOAuthClient } from '../google/auth.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.DRY_RUN) throw new Error('DRY_RUN deve ser true para executar google:test.');
  const credentials = requireGoogleCredentials(config);
  const auth = createGoogleOAuthClient(credentials);
  const calendar = google.calendar({ version: 'v3', auth });
  const gmail = google.gmail({ version: 'v1', auth });

  const calendarResult = await calendar.events.list({
    calendarId: config.GOOGLE_CALENDAR_ID,
    timeMin: new Date().toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 5,
  });
  console.log('Google Calendar: OK (somente leitura)');
  for (const event of calendarResult.data.items ?? []) {
    console.log(
      `- ${event.start?.dateTime ?? event.start?.date ?? 'sem data'} — ${event.summary ?? 'sem título'}`,
    );
  }

  await gmail.users.messages.list({ userId: 'me', maxResults: 1 });
  console.log('Gmail: OK (somente leitura)');
  console.log('Nenhum evento ou e-mail foi criado, alterado ou removido.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Falha no teste Google.');
  process.exitCode = 1;
});
