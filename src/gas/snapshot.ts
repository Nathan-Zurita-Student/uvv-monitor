import { memoryFromRow, personalReminderFromRow } from '../assistant/memory.js';
import type { CalendarEvent } from '../assistant/types.js';
import { createRenderContext, type RenderContext } from '../bot/screens.js';
import { applyUserStatuses } from '../bot/status.js';
import type { AcademicItem } from '../models/academic-item.js';
import { classSlotFromRow, type ClassSlot } from '../models/class-schedule.js';
import { portalDocumentFromRow, type PortalDocument } from '../models/portal-document.js';
import {
  academicItemFromRow,
  batchFromRow,
  reminderFromRow,
  userStatusFromRow,
} from '../persistence/rows.js';
import { SheetStore } from './sheet-store.js';

/**
 * Cópia da planilha no CacheService. Abrir e ler a planilha leva 2 s ou mais; a cópia comprimida
 * sai em ~0,1 s. As atividades (grandes, mudam só na coleta) ficam separadas do estado do usuário
 * (pequeno, muda a cada toque ou conversa). O monitor pede uma cópia nova ao fim de cada coleta, e
 * o acionador de lembretes a renova se estiver com mais de 30 minutos.
 */
export interface Snapshot {
  builtAt: string;
  /** Início da mesma execução representada por lastSyncAt/lastRun. */
  lastRunStartedAt?: string;
  lastSyncAt?: string;
  /** Situação das fontes na última coleta, sem conteúdo ou erros sensíveis. */
  lastRun?: { portal: string; gmail: string; calendar: string };
  items: string[][];
  statuses: string[][];
  reminders: string[][];
  batches: string[][];
  personal: string[][];
  memory: string[][];
  /** Quadro de Horários do Portal (aba class_schedule). */
  classes: string[][];
  /** Arquivos dos posts dos professores, sem o texto (aba portal_documents). */
  files: string[][];
}

type SnapshotState = Omit<Snapshot, 'items'>;

/** Abas que o bot altera e que a cópia acompanha. */
export type WritableTable =
  'user_task_status' | 'reminders' | 'personal_reminders' | 'assistant_memory';

const fieldOf: Record<WritableTable, keyof SnapshotState> = {
  user_task_status: 'statuses',
  reminders: 'reminders',
  personal_reminders: 'personal',
  assistant_memory: 'memory',
};

export interface SheetWrite {
  table: WritableTable;
  row: string[];
  /** Remove a linha com essa chave em vez de gravar. */
  remove?: boolean;
}

const ITEMS_KEY = 'snap.items';
const STATE_KEY = 'snap.state';
/** O CacheService aceita até 100 KB por valor. */
const CHUNK_SIZE = 90_000;
const MAX_CHUNKS = 10;
/** Máximo permitido pelo CacheService (6 horas). */
const CACHE_TTL_SECONDS = 21_600;
export const MAX_SNAPSHOT_AGE_MS = 30 * 60_000;
/** Lotes antigos (paginadores de mensagens velhas) são lidos da planilha quando aparecem. */
const MAX_CACHED_BATCHES = 100;
/** Lembretes pessoais já enviados há muito tempo não precisam ficar na cópia. */
const MAX_CACHED_PERSONAL = 150;

function chunkKeys(prefix: string): string[] {
  return [
    prefix,
    ...Array.from({ length: MAX_CHUNKS }, (_, index) => `${prefix}.${String(index)}`),
  ];
}

function pack(prefix: string, value: unknown): Record<string, string> | undefined {
  const blob = Utilities.newBlob(JSON.stringify(value), 'application/json');
  const encoded = Utilities.base64Encode(Utilities.gzip(blob).getBytes());
  const count = Math.ceil(encoded.length / CHUNK_SIZE);
  if (count > MAX_CHUNKS) return undefined;
  const values: Record<string, string> = { [prefix]: String(count) };
  for (let index = 0; index < count; index += 1) {
    values[`${prefix}.${String(index)}`] = encoded.slice(
      index * CHUNK_SIZE,
      (index + 1) * CHUNK_SIZE,
    );
  }
  return values;
}

function unpack<T>(prefix: string, values: Record<string, string>): T | undefined {
  const count = Number(values[prefix] ?? 0);
  if (!count) return undefined;
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const part = values[`${prefix}.${String(index)}`];
    // O cache pode descartar um pedaço a qualquer momento: aí a cópia é refeita.
    if (!part) return undefined;
    parts.push(part);
  }
  try {
    const blob = Utilities.newBlob(Utilities.base64Decode(parts.join('')), 'application/x-gzip');
    return JSON.parse(Utilities.ungzip(blob).getDataAsString()) as T;
  } catch {
    return undefined;
  }
}

function complete(state: SnapshotState): SnapshotState {
  return { ...state, personal: state.personal ?? [], memory: state.memory ?? [] };
}

/** Cópias feitas por versões anteriores (sem as abas novas) são refeitas a partir da planilha. */
function current(state: SnapshotState | undefined): state is SnapshotState {
  return Boolean(
    state &&
    Array.isArray(state.personal) &&
    Array.isArray(state.memory) &&
    Array.isArray(state.classes) &&
    Array.isArray(state.files),
  );
}

export function readState(): SnapshotState | undefined {
  const state = unpack<SnapshotState>(
    STATE_KEY,
    CacheService.getScriptCache().getAll(chunkKeys(STATE_KEY)),
  );
  return current(state) ? state : undefined;
}

export function readSnapshot(): Snapshot | undefined {
  const values = CacheService.getScriptCache().getAll([
    ...chunkKeys(STATE_KEY),
    ...chunkKeys(ITEMS_KEY),
  ]);
  const state = unpack<SnapshotState>(STATE_KEY, values);
  const items = unpack<string[][]>(ITEMS_KEY, values);
  if (!current(state) || !items) return undefined;
  return { ...complete(state), items };
}

export function saveSnapshot(snapshot: Snapshot, withItems: boolean): void {
  const cache = CacheService.getScriptCache();
  const { items, ...state } = snapshot;
  const packedState = pack(STATE_KEY, {
    ...state,
    batches: state.batches.slice(-MAX_CACHED_BATCHES),
    personal: state.personal.slice(-MAX_CACHED_PERSONAL),
  });
  const packedItems = withItems ? pack(ITEMS_KEY, items) : {};
  if (!packedState || !packedItems) {
    // Grande demais para o cache: cada toque volta a ler a planilha (mais lento, mas correto).
    cache.removeAll([STATE_KEY, ITEMS_KEY]);
    return;
  }
  cache.putAll({ ...packedState, ...packedItems }, CACHE_TTL_SECONDS);
}

/** Lê as abas usadas pelo bot e guarda a cópia no cache. */
export function buildSnapshot(sheetId: string): Snapshot {
  const store = SheetStore.open(sheetId);
  const finished = store
    .rows('run_history')
    .filter((row) => Number.isFinite(Date.parse(row[2] ?? '')))
    .sort((a, b) => Date.parse(a[2]!) - Date.parse(b[2]!));
  const latest = finished.at(-1);
  const lastRunStartedAt = latest?.[1];
  const lastSyncAt = latest?.[2];
  const snapshot: Snapshot = {
    builtAt: new Date().toISOString(),
    ...(lastRunStartedAt ? { lastRunStartedAt } : {}),
    ...(lastSyncAt ? { lastSyncAt } : {}),
    ...(latest
      ? {
          lastRun: {
            portal: latest[3] ?? 'NOT_STARTED',
            gmail: latest[4] ?? 'NOT_STARTED',
            calendar: latest[5] ?? 'NOT_STARTED',
          },
        }
      : {}),
    items: store.rows('detected_items'),
    statuses: store.rows('user_task_status'),
    reminders: store.rows('reminders'),
    batches: store.rows('telegram_batches'),
    personal: store.rows('personal_reminders'),
    memory: store.rows('assistant_memory'),
    classes: store.rows('class_schedule'),
    files: store.rows('portal_documents'),
  };
  try {
    saveSnapshot(snapshot, true);
  } catch (error) {
    console.error(`Cópia em cache não salva: ${String(error)}`);
  }
  return snapshot;
}

export function covers(
  snapshot: Snapshot,
  needed: { itemIds: string[]; batchIds: string[] },
): boolean {
  const has = (rows: string[][], key: string) => rows.some((row) => row[0] === key);
  return (
    needed.itemIds.every((id) => has(snapshot.items, id)) &&
    needed.batchIds.every((id) => has(snapshot.batches, id))
  );
}

/** Cópia do cache; relê a planilha se ela sumiu ou não tem o que o toque precisa (coleta nova). */
export function loadSnapshot(
  sheetId: string,
  needed: { itemIds: string[]; batchIds: string[] } = { itemIds: [], batchIds: [] },
): Snapshot {
  const cached = readSnapshot();
  return cached && covers(cached, needed) ? cached : buildSnapshot(sheetId);
}

/** Aplica gravações à cópia (sem tocar na planilha). */
export function applyWrites(snapshot: Snapshot, writes: SheetWrite[]): Snapshot {
  let updated = snapshot;
  for (const write of writes) {
    const field = fieldOf[write.table];
    const rows = updated[field] as string[][];
    const without = rows.filter((existing) => existing[0] !== write.row[0]);
    const index = rows.findIndex((existing) => existing[0] === write.row[0]);
    const next = write.remove
      ? without
      : index >= 0
        ? rows.map((existing, position) => (position === index ? write.row : existing))
        : [...rows, write.row];
    updated = { ...updated, [field]: next };
  }
  return updated;
}

/** Grava na planilha e atualiza a cópia em cache (que os próximos toques vão usar). */
export function persist(writes: SheetWrite[], snapshot: Snapshot, sheetId: string): Snapshot {
  if (writes.length === 0) return snapshot;
  const store = SheetStore.open(sheetId);
  for (const write of writes) {
    if (write.remove) store.remove(write.table, write.row[0] ?? '');
    else store.upsert(write.table, write.row);
  }
  const updated = applyWrites(snapshot, writes);
  saveSnapshot(updated, false);
  return updated;
}

export function filesOf(snapshot: Snapshot): PortalDocument[] {
  return snapshot.files.flatMap((row) => portalDocumentFromRow(row) ?? []);
}

export function classesOf(snapshot: Snapshot): ClassSlot[] {
  return snapshot.classes.flatMap((row) => classSlotFromRow(row) ?? []);
}

export function itemsOf(snapshot: Snapshot): AcademicItem[] {
  return applyUserStatuses(
    snapshot.items.map(academicItemFromRow),
    snapshot.statuses.map(userStatusFromRow),
  );
}

export function renderContextOf(
  snapshot: Snapshot,
  now: Date,
  calendar?: { events?: CalendarEvent[]; error?: boolean },
): RenderContext {
  return createRenderContext({
    now,
    items: itemsOf(snapshot),
    reminders: snapshot.reminders.map(reminderFromRow),
    batches: snapshot.batches.map(batchFromRow),
    ...(snapshot.lastSyncAt ? { lastSyncAt: snapshot.lastSyncAt } : {}),
    materials: filesOf(snapshot),
    schedule: {
      memory: snapshot.memory.flatMap((row) => memoryFromRow(row) ?? []),
      personalReminders: snapshot.personal.flatMap((row) => personalReminderFromRow(row) ?? []),
      classes: classesOf(snapshot),
      ...(calendar?.events ? { events: calendar.events } : {}),
      ...(calendar?.error ? { calendarError: true } : {}),
    },
  });
}
