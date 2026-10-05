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

/**
 * Reenvia arquivos que o monitor já mandou (pelo file_id: sem novo upload). Até 10 por álbum.
 */
export function sendFilesById(
  props: BotProperties,
  files: Array<{ fileId: string; caption?: string }>,
): void {
  for (let start = 0; start < files.length; start += 10) {
    const part = files.slice(start, start + 10);
    const caption = (file: { caption?: string }) =>
      file.caption ? { caption: file.caption.slice(0, 1024), parse_mode: 'HTML' } : {};
    if (part.length === 1) {
      const [file] = part as [{ fileId: string; caption?: string }];
      telegram(props.botToken, 'sendDocument', {
        chat_id: props.chatId,
        document: file.fileId,
        ...caption(file),
      });
    } else {
      telegram(props.botToken, 'sendMediaGroup', {
        chat_id: props.chatId,
        media: part.map((file) => ({ type: 'document', media: file.fileId, ...caption(file) })),
      });
    }
  }
}

/** "digitando…" no Telegram enquanto o assistente pensa (dura ~5 s). */
export function typing(props: BotProperties): void {
  try {
    telegram(props.botToken, 'sendChatAction', { chat_id: props.chatId, action: 'typing' });
  } catch {
    // Só um indicador visual.
  }
}
