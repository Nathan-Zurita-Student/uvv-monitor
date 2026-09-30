import { loadConfig, requireGoogleCredentials } from '../config/env.js';
import { GoogleSheetsAcademicRepository } from '../persistence/google-sheets.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.DRY_RUN) throw new Error('DRY_RUN deve permanecer true durante sheets:setup.');
  const repository = GoogleSheetsAcademicRepository.fromCredentials(
    requireGoogleCredentials(config),
  );
  await repository.initialize();
  console.log('Google Sheets: abas verificadas/criadas sem apagar dados existentes.');
  console.log('detected_items: OK');
  console.log('user_task_status: OK');
  console.log('run_history: OK');
  console.log('telegram_state: OK');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Falha no setup do Sheets.');
  process.exitCode = 1;
});
