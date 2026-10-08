import { dueDigestSlot, renderDailyDigest, type DigestSlot } from '../bot/daily-digest.js';
import { buildSnapshot, renderContextOf } from './snapshot.js';
import { sendHtml, type BotProperties } from './telegram-api.js';
import { localDateAt, localDateKey } from '../utils/dates.js';
import type { Snapshot } from './snapshot.js';

export const DIGEST_ENABLED = 'DAILY_DIGEST_ENABLED';
export const DIGEST_TOKEN = 'DAILY_DIGEST_TOKEN';

/**
 * Uma coleta pertence ao resumo quando começou dentro da janela iniciada pelo agendador daquele
 * horário e já terminou. O workflow de reserva começa 25 minutos antes; usamos 30 para tolerar
 * relógios e fila.
 */
export function collectionCoversDigest(
  startedAt: string | undefined,
  finishedAt: string | undefined,
  now: Date,
  slot: DigestSlot,
): boolean {
  const started = Date.parse(startedAt ?? '');
  const finished = Date.parse(finishedAt ?? '');
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(finished) ||
    started > finished ||
    finished > now.getTime() + 60_000
  )
    return false;
  const [hours = 0, minutes = 0] = slot.split(':').map(Number);
  return started >= localDateAt(now, hours, minutes - 30).getTime();
}

/** Credencial separada: só pode pedir o resumo do horário atual; não lê dados nem altera tarefas. */
export function digestAuthorized(token: unknown): boolean {
  const configured = PropertiesService.getScriptProperties().getProperty(DIGEST_TOKEN);
  return (
    typeof token === 'string' &&
    Boolean(configured && configured.length >= 32 && token === configured)
  );
}

/** Deve ser chamado com o ScriptLock adquirido, inclusive pelo fallback de cinco minutos. */
export function sendScheduledDigest(
  props: BotProperties,
  now = new Date(),
  refreshedSnapshot?: Snapshot,
): 'disabled' | 'idle' | 'waiting' | 'sent' {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(DIGEST_ENABLED) !== 'true') return 'disabled';
  const slot = dueDigestSlot(now, (key) => Boolean(properties.getProperty(`digest.sent.${key}`)));
  if (!slot) return 'idle';
  // Relê os status do usuário e as fontes: concluídos e ignorados não reaparecem por cache antigo.
  const snapshot = refreshedSnapshot ?? buildSnapshot(props.sheetId);
  // Falha fechada: nunca entrega um resumo com a memória anterior enquanto a coleta do horário
  // ainda está na fila ou executando. O acionador de 5 minutos e o callback final tentam de novo.
  if (!collectionCoversDigest(snapshot.lastRunStartedAt, snapshot.lastSyncAt, now, slot))
    return 'waiting';
  const rendered = renderDailyDigest(renderContextOf(snapshot, now), slot, snapshot.lastRun);
  sendHtml(props, rendered.text, rendered.keyboard);
  const key = `${localDateKey(now)} ${slot}`;
  // Marca só depois de Telegram confirmar. Não usa cache descartável como memória de entrega.
  properties.setProperty(`digest.sent.${key}`, now.toISOString());
  // Retenção limitada; mantém apenas sete dias de comprovantes (limite das Script Properties).
  for (const name of Object.keys(properties.getProperties())) {
    if (
      name.startsWith('digest.sent.') &&
      now.getTime() - Date.parse(properties.getProperty(name) ?? '') > 7 * 24 * 60 * 60_000
    )
      properties.deleteProperty(name);
  }
  return 'sent';
}
