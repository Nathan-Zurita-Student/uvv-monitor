import { loadConfig, requireTelegramCredentials } from '../config/env.js';
import { TelegramClient } from '../telegram/client.js';

async function main(): Promise<void> {
  const credentials = requireTelegramCredentials(loadConfig());
  const client = new TelegramClient(credentials.botToken, credentials.chatId);
  await client.sendMessage('UVV Monitor: integração Telegram funcionando.');
  console.log('Telegram: OK');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Falha no teste do Telegram.');
  process.exitCode = 1;
});
