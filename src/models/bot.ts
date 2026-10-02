/** Lembrete pedido pelo usuário no Telegram; um por item, substituído a cada novo pedido. */
export interface Reminder {
  itemId: string;
  remindAt: string;
  createdAt: string;
  sentAt?: string;
  chatId: string;
}

/** Nível de urgência já avisado, para não repetir o mesmo alerta. */
export type NotifiedLevel = 'none' | 'high' | 'critical' | 'overdue';

export interface NotificationLogEntry {
  itemId: string;
  /** Assinatura dos campos relevantes no último aviso (prazo, título, disciplina...). */
  signature: string;
  level: NotifiedLevel;
  lastNotifiedAt: string;
}

/** Por que um item entrou em um resumo de novidades. */
export type NotificationReason = 'new' | 'date' | 'changed' | 'urgent' | 'notice';

/** Itens de um resumo, navegados com ⬅️ 1/3 ➡️ na própria mensagem. */
export interface TelegramBatch {
  batchId: string;
  createdAt: string;
  entries: Array<{ itemId: string; reason: NotificationReason }>;
}
