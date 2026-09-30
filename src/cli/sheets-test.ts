import { google } from 'googleapis';
import { loadConfig, requireGoogleCredentials } from '../config/env.js';
import { createGoogleOAuthClient } from '../google/auth.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.DRY_RUN) throw new Error('DRY_RUN deve ser true para executar sheets:test.');
  const credentials = requireGoogleCredentials(config);
  const sheets = google.sheets({ version: 'v4', auth: createGoogleOAuthClient(credentials) });
  const response = await sheets.spreadsheets.get({
    spreadsheetId: credentials.sheetId,
    fields: 'properties.title,sheets.properties.title',
  });
  console.log(`Google Sheets: OK — ${response.data.properties?.title ?? 'planilha acessível'}`);
  console.log('Abas encontradas:');
  for (const sheet of response.data.sheets ?? []) {
    console.log(`- ${sheet.properties?.title ?? 'sem nome'}`);
  }
  console.log('Nenhum dado foi alterado.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Falha no teste do Sheets.');
  process.exitCode = 1;
});
