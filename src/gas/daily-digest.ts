import { dueDigestSlot, renderDailyDigest } from '../bot/daily-digest.js';
import { buildSnapshot, renderContextOf } from './snapshot.js';
import { sendHtml, type BotProperties } from './telegram-api.js';
import { localDateKey } from '../utils/dates.js';

export const DIGEST_ENABLED = 'DAILY_DIGEST_ENABLED';
export const DIGEST_TOKEN = 'DAILY_DIGEST_TOKEN';

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
): 'disabled' | 'idle' | 'sent' {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(DIGEST_ENABLED) !== 'true') return 'disabled';
  const slot = dueDigestSlot(now, (key) => Boolean(properties.getProperty(`digest.sent.${key}`)));
  if (!slot) return 'idle';
  // Relê os status do usuário e as fontes: concluídos e ignorados não reaparecem por cache antigo.
  const snapshot = buildSnapshot(props.sheetId);
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
