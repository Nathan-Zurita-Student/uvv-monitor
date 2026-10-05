import type { TelegramApiResponse, TelegramMessage, TelegramUpdate } from './types.js';

const maxTelegramMessageLength = 4096;

export type TelegramButton =
  { text: string; callback_data: string } | { text: string; url: string };

export interface TelegramMessageOptions {
  inlineKeyboard?: TelegramButton[][];
  replyKeyboard?: string[][];
  /** Mensagens são HTML por padrão; use `false` para texto puro. */
  html?: boolean;
  silent?: boolean;
  /** Abre o campo de resposta (usado em "Escolher horário"). */
  forceReply?: boolean;
}

export interface OutgoingFile {
  bytes: Uint8Array;
  fileName: string;
  contentType?: string;
  /** Legenda em HTML (até 1024 caracteres). */
  caption?: string;
}

interface TelegramFileMessage {
  message_id: number;
  document?: { file_id: string };
}

/** O que o restante do sistema precisa do Telegram; facilita testes com um envio falso. */
export interface TelegramSender {
  sendMessage(text: string, options?: TelegramMessageOptions): Promise<TelegramMessage>;
  pinChatMessage(messageId: number): Promise<void>;
  unpinChatMessage(messageId: number): Promise<void>;
}

export class TelegramClient implements TelegramSender {
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

  /** URL do webhook ativo ("" quando o bot usa getUpdates). */
  async webhookUrl(): Promise<string> {
    const info = await this.call<{ url?: string }>('getWebhookInfo', {});
    return info.url ?? '';
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
        isLastChunk && options.forceReply
          ? { force_reply: true, input_field_placeholder: 'Ex.: amanhã 9h' }
          : isLastChunk && options.inlineKeyboard && options.inlineKeyboard.length > 0
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
        ...(options.html === false ? {} : { parse_mode: 'HTML' }),
        ...(options.silent ? { disable_notification: true } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    }
    if (!sent) throw new Error('Telegram não retornou a mensagem enviada.');
    return sent;
  }

  /**
   * Envia arquivos como documentos (qualidade original, inclusive imagens). De 2 a 10 viram um
   * álbum. Devolve o file_id de cada arquivo, na mesma ordem, para reenviar sem novo upload.
   */
  async sendFiles(files: OutgoingFile[], options: { silent?: boolean } = {}): Promise<string[]> {
    if (files.length === 0) return [];
    if (files.length > 10) throw new Error('Um álbum do Telegram aceita até 10 arquivos.');
    const form = new FormData();
    form.set('chat_id', this.chatId);
    if (options.silent) form.set('disable_notification', 'true');
    const blob = (file: OutgoingFile) =>
      new Blob([new Uint8Array(file.bytes)], {
        type: file.contentType || 'application/octet-stream',
      });
    if (files.length === 1) {
      const [file] = files as [OutgoingFile];
      form.set('document', blob(file), file.fileName);
      if (file.caption) {
        form.set('caption', file.caption.slice(0, 1024));
        form.set('parse_mode', 'HTML');
      }
      const message = await this.upload<TelegramFileMessage>('sendDocument', form);
      return [message.document?.file_id ?? ''];
    }
    form.set(
      'media',
      JSON.stringify(
        files.map((file, index) => ({
          type: 'document',
          media: `attach://file${String(index)}`,
          ...(file.caption ? { caption: file.caption.slice(0, 1024), parse_mode: 'HTML' } : {}),
        })),
      ),
    );
    files.forEach((file, index) => form.set(`file${String(index)}`, blob(file), file.fileName));
    const messages = await this.upload<TelegramFileMessage[]>('sendMediaGroup', form);
    return messages.map((message) => message.document?.file_id ?? '');
  }

  /** Upload multipart com nova tentativa quando o Telegram pede para esperar (HTTP 429). */
  private async upload<T>(method: string, form: FormData): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetch(`${this.baseUrl}/${method}`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      const payload = (await response
        .json()
        .catch(() => ({ ok: false }))) as TelegramApiResponse<T> & {
        parameters?: { retry_after?: number };
      };
      if (payload.ok) return payload.result;
      const wait = payload.parameters?.retry_after;
      if (response.status === 429 && wait && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
        continue;
      }
      throw new Error(
        `Telegram rejeitou ${method}: ${payload.description ?? `HTTP ${String(response.status)}`}.`,
      );
    }
  }

  async pinChatMessage(messageId: number): Promise<void> {
    await this.call('pinChatMessage', {
      chat_id: this.chatId,
      message_id: messageId,
      disable_notification: true,
    });
  }

  async unpinChatMessage(messageId: number): Promise<void> {
    await this.call('unpinChatMessage', { chat_id: this.chatId, message_id: messageId });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  async editMessageReplyMarkup(
    chatId: string,
    messageId: number,
    inlineKeyboard: TelegramButton[][],
  ): Promise<void> {
    await this.call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: inlineKeyboard },
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
      parse_mode: 'HTML',
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
    // Prefere quebrar entre blocos para não cortar tags HTML no meio.
    const blockBreak = candidate.lastIndexOf('\n\n');
    const splitAt =
      blockBreak > maxTelegramMessageLength / 2
        ? blockBreak
        : Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
    const end = splitAt > 0 ? splitAt : maxTelegramMessageLength;
    chunks.push(remaining.slice(0, end).trimEnd());
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
