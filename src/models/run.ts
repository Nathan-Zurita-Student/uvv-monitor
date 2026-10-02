export type SourceRunStatus = 'NOT_STARTED' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NOT_VERIFIED';

export interface RunHistory {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  portalStatus: SourceRunStatus;
  gmailStatus: SourceRunStatus;
  calendarStatus: SourceRunStatus;
  itemsFound: number;
  errors: string[];
}

export interface TelegramState {
  lastUpdateId: number;
  /** Mensagem do painel fixada no chat, desafixada quando um painel novo chega. */
  panelMessageId?: number;
}
