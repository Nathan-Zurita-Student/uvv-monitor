import type { AcademicItem, ItemStatus, UserTaskStatus } from '../models/academic-item.js';

/** Rótulos visíveis de andamento. "🔴 Atrasada" é derivado do prazo, não um status salvo. */
export const statusLabels: Record<ItemStatus, string> = {
  TODO: '⏳ Não iniciada',
  IN_PROGRESS: '🔵 Em andamento',
  DONE: '✅ Concluída',
  WAITING: '⏸️ Aguardando',
  NEEDS_CONFIRMATION: '⚠️ A confirmar',
  IGNORED: '🙈 Ignorada',
};

export const OVERDUE_LABEL = '🔴 Atrasada';

const openStatuses = new Set<ItemStatus>(['TODO', 'IN_PROGRESS', 'WAITING', 'NEEDS_CONFIRMATION']);

export function isOpenStatus(status: ItemStatus): boolean {
  return openStatuses.has(status);
}

/**
 * O status do usuário vale para a organização pessoal. A única exceção é a fonte confirmar a
 * conclusão (ex.: o AVA marcou a atividade como concluída), que fecha a pendência.
 */
export function effectiveStatus(sourceStatus: ItemStatus, userStatus?: ItemStatus): ItemStatus {
  if (!userStatus) return sourceStatus;
  if (sourceStatus === 'DONE' && isOpenStatus(userStatus)) return 'DONE';
  return userStatus;
}

export function applyUserStatuses(
  items: AcademicItem[],
  statuses: Iterable<UserTaskStatus>,
): AcademicItem[] {
  const byItem = new Map<string, ItemStatus>();
  for (const status of statuses) byItem.set(status.itemId.toUpperCase(), status.status);
  return items.map((item) => {
    const userStatus = byItem.get(item.id.toUpperCase());
    const status = effectiveStatus(item.status, userStatus);
    return status === item.status ? item : { ...item, status };
  });
}

/** Registro de status do usuário com as datas de conclusão/ignorado preenchidas. */
export function userStatusRecord(
  itemId: string,
  status: ItemStatus,
  previousStatus: ItemStatus,
  now: string,
): UserTaskStatus {
  return {
    itemId,
    status,
    updatedAt: now,
    source: 'TELEGRAM',
    previousStatus,
    ...(status === 'DONE' ? { completedAt: now } : {}),
    ...(status === 'IGNORED' ? { ignoredAt: now } : {}),
  };
}
