export const itemSources = ['PORTAL', 'GMAIL', 'CALENDAR', 'USER'] as const;
export type ItemSource = (typeof itemSources)[number];

export const itemStatuses = [
  'TODO',
  'IN_PROGRESS',
  'DONE',
  'WAITING',
  'NEEDS_CONFIRMATION',
  'IGNORED',
] as const;
export type ItemStatus = (typeof itemStatuses)[number];

export const urgencyLevels = [
  'OVERDUE',
  'TODAY',
  'NEXT_24_HOURS',
  'NEXT_72_HOURS',
  'THIS_WEEK',
  'FUTURE',
  'INFORMATIONAL',
] as const;
export type Urgency = (typeof urgencyLevels)[number];

export const itemTypes = [
  'MESSAGE',
  'ACTIVITY',
  'EXAM',
  'ASSIGNMENT',
  'AOP',
  'SCHEDULE_CHANGE',
  'CLASS',
  'EVENT',
  'SERVICE_REQUEST',
  'DOCUMENT',
  'GRADE',
  'NOTICE',
] as const;
export type ItemType = (typeof itemTypes)[number];

export interface AcademicItem {
  id: string;
  externalId: string;
  source: ItemSource;
  sourceUrl: string;
  discipline?: string;
  title: string;
  description: string;
  type: ItemType;
  officialDate?: string;
  officialDeadline?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  contentHash: string;
  previousHash?: string;
  calendarEventId?: string;
  status: ItemStatus;
  urgency: Urgency;
  metadata?: Record<string, string>;
}

/** Status definido pelo usuário no bot; tem prioridade sobre o status da fonte (AVA/Portal). */
export interface UserTaskStatus {
  itemId: string;
  status: ItemStatus;
  updatedAt: string;
  source: 'TELEGRAM' | 'SYSTEM' | 'USER';
  previousStatus?: ItemStatus;
  completedAt?: string;
  ignoredAt?: string;
}

export interface TelegramTaskMessage {
  itemId: string;
  chatId: string;
  messageId: number;
  lastRenderedStatus: ItemStatus;
  updatedAt: string;
  actionToken?: string;
  /** Texto HTML do cartão com {{STATUS}}; permite reeditar a mensagem mantendo o layout. */
  renderedText?: string;
}
