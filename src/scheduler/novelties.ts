import type { AcademicItem } from '../models/academic-item.js';
import type { ItemChange } from '../persistence/deduplication.js';

const dateFields = new Set<ItemChange['field']>(['officialDate', 'officialDeadline']);

/** Prazo oficial que apenas confirma a data que a IA já tinha lido no texto não vira alerta. */
function confirmsAiDate(item: AcademicItem, changes: ItemChange[]): boolean {
  const aiDay = item.metadata?.aiDueDate?.slice(0, 10);
  return (
    Boolean(aiDay) &&
    changes.every(
      (change) =>
        dateFields.has(change.field) &&
        !change.before &&
        (!change.after || change.after.slice(0, 10) === aiDay),
    )
  );
}

/** Decide se uma alteração detectada merece aviso no Telegram. */
export function isMeaningfulChange(item: AcademicItem, changes: ItemChange[]): boolean {
  if (changes.length === 0) return false;
  const enrichmentOnly = changes.every(({ field }) =>
    ['description', 'discipline'].includes(field),
  );
  const previousDescription = changes.find(({ field }) => field === 'description')?.before;
  // Coletas que só detalharam o texto do mesmo post não são novidade.
  if (enrichmentOnly && previousDescription === item.metadata?.originalTitle) return false;
  return !confirmsAiDate(item, changes);
}
