import 'dotenv/config';
import { TelegramClient } from '../telegram/client.js';

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN: MISSING');
  process.exitCode = 1;
} else {
  const client = new TelegramClient(token, '');
  try {
    const updates = await client.getUpdates(0);
    const chats = new Map<string, { id: string; name: string; username?: string }>();
    for (const update of updates) {
      const message = update.message ?? update.callback_query?.message;
      if (!message) continue;
      const id = String(message.chat.id);
      const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ');
      chats.set(id, {
        id,
        name: name || 'Nome não informado',
        ...(message.from?.username ? { username: message.from.username } : {}),
      });
    }

    if (chats.size === 0) {
      console.log('Nenhum chat encontrado.');
      console.log('1. Abra seu bot no Telegram.');
      console.log('2. Clique em Start.');
      console.log('3. Envie uma mensagem como "oi".');
      console.log('4. Execute novamente: npm run telegram:get-chat-id');
    } else {
      console.log('Chats encontrados:');
      for (const chat of chats.values()) {
        console.log(`chat.id: ${chat.id}`);
        console.log(`nome: ${chat.name}`);
        if (chat.username) console.log(`username: @${chat.username}`);
        console.log(`Use localmente: TELEGRAM_CHAT_ID=${chat.id}\n`);
      }
      console.log('O arquivo .env não foi alterado.');
    }
  } catch (error) {
    console.error(`Falha no getUpdates: ${error instanceof Error ? error.message : 'erro'}`);
    process.exitCode = 1;
  }
}
