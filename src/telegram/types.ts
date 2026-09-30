export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: { id: number };
  reply_to_message?: { text?: string };
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}
