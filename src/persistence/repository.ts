import type { AcademicItem, UserTaskStatus } from '../models/academic-item.js';
import type { RunHistory, TelegramState } from '../models/run.js';

export interface AcademicRepository {
  initialize(): Promise<void>;
  listDetectedItems(): Promise<AcademicItem[]>;
  upsertDetectedItems(items: AcademicItem[]): Promise<void>;
  listTaskStatuses(): Promise<UserTaskStatus[]>;
  upsertTaskStatus(status: UserTaskStatus): Promise<void>;
  appendRunHistory(run: RunHistory): Promise<void>;
  getTelegramState(): Promise<TelegramState>;
  setTelegramState(state: TelegramState): Promise<void>;
}
