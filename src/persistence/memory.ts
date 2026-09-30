import type { AcademicItem, UserTaskStatus } from '../models/academic-item.js';
import type { RunHistory, TelegramState } from '../models/run.js';
import type { AcademicRepository } from './repository.js';

export class InMemoryAcademicRepository implements AcademicRepository {
  readonly items = new Map<string, AcademicItem>();
  readonly statuses = new Map<string, UserTaskStatus>();
  readonly runs: RunHistory[] = [];
  telegramState: TelegramState = { lastUpdateId: 0 };

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  listDetectedItems(): Promise<AcademicItem[]> {
    return Promise.resolve(Array.from(this.items.values()));
  }

  upsertDetectedItems(items: AcademicItem[]): Promise<void> {
    for (const item of items) this.items.set(item.id, structuredClone(item));
    return Promise.resolve();
  }

  listTaskStatuses(): Promise<UserTaskStatus[]> {
    return Promise.resolve(Array.from(this.statuses.values()));
  }

  upsertTaskStatus(status: UserTaskStatus): Promise<void> {
    this.statuses.set(status.itemId, structuredClone(status));
    return Promise.resolve();
  }

  appendRunHistory(run: RunHistory): Promise<void> {
    this.runs.push(structuredClone(run));
    return Promise.resolve();
  }

  getTelegramState(): Promise<TelegramState> {
    return Promise.resolve(structuredClone(this.telegramState));
  }

  setTelegramState(state: TelegramState): Promise<void> {
    this.telegramState = structuredClone(state);
    return Promise.resolve();
  }
}
