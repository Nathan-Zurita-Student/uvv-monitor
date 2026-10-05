/**
 * Tipos do assistente acadêmico. Este diretório não depende do Node: é empacotado no Apps Script
 * junto com o bot, e o mesmo código é testado no vitest com dependências falsas.
 */

/** Ordem de confiança das fontes, da mais confiável para a menos (1 = confirmado pelo usuário). */
export const sourceReliability = {
  usuario: 1,
  agenda: 2,
  portal: 3,
  ava: 3,
  email: 4,
  telegram: 4,
  memoria: 4,
  inferido: 5,
} as const;
export type InfoSource = keyof typeof sourceReliability;

export const academicCategories = [
  'prova',
  'trabalho',
  'aop',
  'exercicio',
  'aula',
  'atividade',
  'apresentacao',
  'seminario',
  'entrega',
  'estagio',
  'documento',
  'aviso',
  'nota',
  'pendencia',
] as const;
export type AcademicCategory = (typeof academicCategories)[number];

/** Evento da Google Agenda já convertido para instantes absolutos. */
export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  description?: string;
  location?: string;
  /** Criado pelo monitor a partir de um item acadêmico (o item já o representa). */
  academicItemId?: string;
  /** Criado pelo assistente (bloco de estudo, compromisso pedido no Telegram). */
  createdByAssistant?: boolean;
  recurring?: boolean;
}

export interface CalendarEventInput {
  title: string;
  start: Date;
  end: Date;
  description?: string;
  /** Minutos antes do início para os avisos da própria Agenda. */
  popupMinutes: number[];
  colorId?: string;
  relatedItemId?: string;
}

export interface CalendarEventPatch {
  title?: string;
  start?: Date;
  end?: Date;
  description?: string;
}

export interface PersonalReminder {
  id: string;
  title: string;
  description: string;
  remindAt: string;
  urgent: boolean;
  chatId: string;
  itemId?: string;
  calendarEventId?: string;
  sentAt?: string;
}

export const memoryCategories = [
  'aula',
  'disciplina',
  'professor',
  'preferencia',
  'rotina',
  'nota',
] as const;
export type MemoryCategory = (typeof memoryCategories)[number];

/** Fato útil e duradouro que o usuário contou (horário de aula, preferência, professor...). */
export interface MemoryFact {
  id: string;
  category: MemoryCategory;
  subject: string;
  content: string;
  /** 0 = domingo ... 6 = sábado (para aulas e rotinas semanais). */
  weekdays?: number[];
  startTime?: string;
  endTime?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface EmailMessage extends EmailSummary {
  body: string;
  attachments: string[];
}

/** Ação arriscada que só é executada depois do "Confirmar" do usuário. */
export type PendingAction =
  | {
      id: string;
      kind: 'delete_event';
      eventId: string;
      title: string;
      summary: string;
      createdAt: string;
    }
  | {
      id: string;
      kind: 'update_event';
      eventId: string;
      title: string;
      patch: { title?: string; start?: string; end?: string; description?: string };
      summary: string;
      createdAt: string;
    }
  | {
      id: string;
      kind: 'cancel_reminder';
      reminderId: string;
      title: string;
      summary: string;
      createdAt: string;
    };

export interface Insight {
  /** Assinatura estável: evita repetir o mesmo alerta. */
  key: string;
  kind:
    'due_soon' | 'overdue' | 'exam_soon' | 'exam_without_study' | 'same_day' | 'overlap' | 'crunch';
  text: string;
  itemIds: string[];
  severity: number;
}
