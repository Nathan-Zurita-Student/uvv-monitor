import type { TelegramApiResponse, TelegramMessage, TelegramUpdate } from './types.js';

const maxTelegramMessageLength = 4096;

export type TelegramButton =
  { text: string; callback_data: string } | { text: string; url: string };

export interface TelegramMessageOptions {
  inlineKeyboard?: TelegramButton[][];
  replyKeyboard?: string[][];
}

export class TelegramClient {
  private readonly baseUrl: string;

  constructor(
    botToken: string,
    private readonly chatId: string,
  ) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Telegram respondeu com HTTP ${response.status}.`);
    const payload = (await response.json()) as TelegramApiResponse<T>;
    if (!payload.ok)
      throw new Error(`Telegram rejeitou ${method}: ${payload.description ?? 'erro'}.`);
    return payload.result;
  }

  getUpdates(offset: number): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>('getUpdates', {
      offset,
      timeout: 0,
      allowed_updates: ['message', 'callback_query'],
    });
  }

  async sendMessage(text: string, options: TelegramMessageOptions = {}): Promise<TelegramMessage> {
    const chunks = splitTelegramMessage(text);
    let sent: TelegramMessage | undefined;
    for (const [index, chunk] of chunks.entries()) {
      const isLastChunk = index === chunks.length - 1;
      const replyMarkup =
        isLastChunk && options.inlineKeyboard
          ? { inline_keyboard: options.inlineKeyboard }
          : isLastChunk && options.replyKeyboard
            ? {
                keyboard: options.replyKeyboard.map((row) =>
                  row.map((buttonText) => ({ text: buttonText })),
                ),
                resize_keyboard: true,
                one_time_keyboard: true,
                input_field_placeholder: 'Escolha uma opção',
              }
            : undefined;
      sent = await this.call<TelegramMessage>('sendMessage', {
        chat_id: this.chatId,
        text: chunk,
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    }
    if (!sent) throw new Error('Telegram não retornou a mensagem enviada.');
    return sent;
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  async editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    inlineKeyboard: TelegramButton[][],
  ): Promise<void> {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
  }
}

export function splitTelegramMessage(text: string): string[] {
  if (text.length <= maxTelegramMessageLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxTelegramMessageLength) {
    const candidate = remaining.slice(0, maxTelegramMessageLength);
    const splitAt = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
    const end = splitAt > 0 ? splitAt : maxTelegramMessageLength;
    chunks.push(remaining.slice(0, end).trimEnd());
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
