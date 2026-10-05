import type { Keyboard } from '../bot/screens.js';

export interface BotProperties {
  botToken: string;
  chatId: string;
  sheetId: string;
  webhookSecret: string;
}

export function telegram(token: string, method: string, payload: Record<string, unknown>): void {
  const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 400) {
    const text = response.getContentText();
    // Repetir a mesma ação (ex.: tocar duas vezes) não é erro.
    if (/message is not modified|query is too old/i.test(text)) return;
    throw new Error(`Telegram rejeitou ${method}: ${text.slice(0, 300)}`);
  }
}

/** Mensagem em HTML (o texto já deve vir escapado). */
export function sendHtml(props: BotProperties, html: string, keyboard?: Keyboard): void {
  telegram(props.botToken, 'sendMessage', {
    chat_id: props.chatId,
    text: html.length > 4000 ? `${html.slice(0, 3990)}…` : html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(keyboard && keyboard.length > 0 ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

/** "digitando…" no Telegram enquanto o assistente pensa (dura ~5 s). */
export function typing(props: BotProperties): void {
  try {
    telegram(props.botToken, 'sendChatAction', { chat_id: props.chatId, action: 'typing' });
  } catch {
    // Só um indicador visual.
  }
}
