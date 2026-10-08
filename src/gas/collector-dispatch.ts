/**
 * Dispara a coleta do monitor no GitHub Actions (workflow_dispatch) a partir do Apps Script.
 *
 * O agendamento do GitHub ("schedule") atrasa horas em períodos de carga; um disparo manual
 * começa assim que há máquina. O acionador de 5 minutos do Apps Script chama `scheduledDispatch`,
 * que antecipa as nove coletas diárias, e o bot oferece "Verificar Portal agora".
 * Precisa de um token do GitHub com permissão só de Actions neste repositório, na propriedade
 * MONITOR_DISPATCH_TOKEN (sem ela, nada é disparado e o agendamento do GitHub continua valendo).
 */
import { localTime } from '../assistant/dates.js';
import { scheduledSlots } from '../scheduler/windows.js';
import { localDateKey } from '../utils/dates.js';

export const DISPATCH_TOKEN_PROPERTY = 'MONITOR_DISPATCH_TOKEN';
const REPOSITORY_PROPERTY = 'MONITOR_REPOSITORY';
const DEFAULT_REPOSITORY = 'Nathan-Zurita-Student/uvv-monitor';
const LAST_SLOT_PROPERTY = 'MONITOR_LAST_DISPATCH';
const TOKEN_NOTICE_PROPERTY = 'MONITOR_TOKEN_NOTICE';
const MANUAL_KEY = 'monitor.manual-dispatch';
const MANUAL_PENDING_PROPERTY = 'MONITOR_MANUAL_PENDING';
/** Atualização pedida no bot: no máximo uma a cada 10 minutos. */
const MANUAL_COOLDOWN_SECONDS = 600;
/** Depois disso, o pedido precisa terminar com um aviso explícito de demora. */
export const MANUAL_TIMEOUT_MS = 25 * 60_000;

export const collectionSlots = scheduledSlots;
export type CollectionSlot = (typeof collectionSlots)[number];

function minutes(time: string): number {
  const [hours = 0, mins = 0] = time.split(':').map(Number);
  return hours * 60 + mins;
}

/** Horário de coleta que acabou de chegar (até 50 min depois) e ainda não foi disparado hoje. */
export function dueSlot(now: Date, lastDispatched: string | null): CollectionSlot | undefined {
  const current = minutes(localTime(now));
  const today = localDateKey(now);
  return collectionSlots.find((slot) => {
    // Coletar antes do aviso: a mensagem do horário não precisa esperar o Playwright.
    const delta = current - (minutes(slot) - 20);
    return delta >= 0 && delta < 70 && lastDispatched !== `${today} ${slot}`;
  });
}

export function dispatchConfigured(): boolean {
  return Boolean(PropertiesService.getScriptProperties().getProperty(DISPATCH_TOKEN_PROPERTY));
}

/**
 * Resultado do pedido ao GitHub: `rejected` é token vencido, revogado ou sem permissão (tentar de
 * novo não adianta); `failed` é instabilidade (vale tentar no próximo minuto do acionador).
 */
export type DispatchResult = 'ok' | 'rejected' | 'failed';

/** Pede ao GitHub uma execução do monitor. */
export function dispatchCollection(slot: CollectionSlot): DispatchResult {
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty(DISPATCH_TOKEN_PROPERTY);
  if (!token) return 'rejected';
  const repository = properties.getProperty(REPOSITORY_PROPERTY) || DEFAULT_REPOSITORY;
  let response: ReturnType<typeof UrlFetchApp.fetch>;
  try {
    response = UrlFetchApp.fetch(
      `https://api.github.com/repos/${repository}/actions/workflows/monitor.yml/dispatches`,
      {
        method: 'post',
        contentType: 'application/json',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'uvv-monitor-apps-script',
        },
        payload: JSON.stringify({ ref: 'main', inputs: { slot } }),
        muteHttpExceptions: true,
      },
    );
  } catch (error) {
    console.error(`GitHub inacessível: ${String(error)}`);
    return 'failed';
  }
  const status = response.getResponseCode();
  if (status === 204) return 'ok';
  // Nunca registra o token; só o código e o começo da resposta do GitHub.
  console.error(
    `GitHub recusou o disparo (${String(status)}): ${response.getContentText().slice(0, 200)}`,
  );
  return status === 401 || status === 403 || status === 404 ? 'rejected' : 'failed';
}

/**
 * Chamado pelo acionador de 5 minutos: dispara a coleta no horário certo, uma vez por horário.
 * Instabilidade do GitHub é tentada de novo a cada 5 minutos dentro da janela; token recusado
 * não (as coletas seguem pelo agendamento de reserva do GitHub).
 */
export function scheduledDispatch(
  now: Date,
): { slot: CollectionSlot; result: DispatchResult } | undefined {
  if (!dispatchConfigured()) return undefined;
  const properties = PropertiesService.getScriptProperties();
  const slot = dueSlot(now, properties.getProperty(LAST_SLOT_PROPERTY));
  if (!slot) return undefined;
  const result = dispatchCollection(slot);
  if (result !== 'failed')
    properties.setProperty(LAST_SLOT_PROPERTY, `${localDateKey(now)} ${slot}`);
  return { slot, result };
}

/** Aviso único por dia quando o GitHub recusa o token (vencido ou revogado). */
export function tokenProblemNotice(now: Date): string | undefined {
  const properties = PropertiesService.getScriptProperties();
  const today = localDateKey(now);
  if (properties.getProperty(TOKEN_NOTICE_PROPERTY) === today) return undefined;
  properties.setProperty(TOKEN_NOTICE_PROPERTY, today);
  return '⚠️ O GitHub recusou a chave que dispara as verificações do Portal (ela pode ter vencido). As verificações continuam pelo agendamento do GitHub, que pode atrasar. Para voltar ao horário certo, gere uma chave nova e atualize MONITOR_DISPATCH_TOKEN.';
}

export type ManualDispatch = 'started' | 'recent' | 'unavailable' | 'failed';

export interface PendingManualDispatch {
  requestedAt: string;
  slot: CollectionSlot;
}

/** Pedido durável: sobrevive à expiração do cache e só some depois do recibo no Telegram. */
export function pendingManualDispatch(): PendingManualDispatch | undefined {
  const raw = PropertiesService.getScriptProperties().getProperty(MANUAL_PENDING_PROPERTY);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<PendingManualDispatch>;
    if (
      typeof value.requestedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.requestedAt)) ||
      !collectionSlots.includes(value.slot as CollectionSlot)
    )
      return undefined;
    return value as PendingManualDispatch;
  } catch {
    return undefined;
  }
}

export function clearPendingManualDispatch(): void {
  PropertiesService.getScriptProperties().deleteProperty(MANUAL_PENDING_PROPERTY);
}

/** A coleta precisa ter terminado depois do pedido e ter começado na mesma janela. */
export function manualDispatchCompleted(
  request: PendingManualDispatch,
  lastRunStartedAt: string | undefined,
  lastSyncAt: string | undefined,
): boolean {
  const requested = Date.parse(request.requestedAt);
  const started = Date.parse(lastRunStartedAt ?? '');
  const finished = Date.parse(lastSyncAt ?? '');
  return (
    Number.isFinite(requested) &&
    Number.isFinite(started) &&
    Number.isFinite(finished) &&
    started >= requested - 2 * 60_000 &&
    finished >= requested &&
    finished >= started
  );
}

/** "Verificar Portal agora" no bot. */
export function slotForManualDispatch(now: Date): CollectionSlot {
  const current = minutes(localTime(now));
  return collectionSlots.find((slot) => minutes(slot) >= current) ?? '23:00';
}

export function manualDispatch(now = new Date()): ManualDispatch {
  if (!dispatchConfigured()) return 'unavailable';
  const cache = CacheService.getScriptCache();
  if (cache.get(MANUAL_KEY)) return 'recent';
  const slot = slotForManualDispatch(now);
  if (dispatchCollection(slot) !== 'ok') return 'failed';
  PropertiesService.getScriptProperties().setProperty(
    MANUAL_PENDING_PROPERTY,
    JSON.stringify({ requestedAt: now.toISOString(), slot } satisfies PendingManualDispatch),
  );
  cache.put(MANUAL_KEY, '1', MANUAL_COOLDOWN_SECONDS);
  return 'started';
}

export const manualDispatchText: Record<ManualDispatch, string> = {
  started:
    '🔄 Comecei uma varredura real do Portal/AVA, Gmail e Agenda. Normalmente leva de 4 a 8 minutos; quando terminar, eu confirmo aqui o horário e o resultado de cada fonte, mesmo que não exista novidade.',
  recent:
    '🔄 A varredura que você pediu ainda está em andamento. Assim que terminar, eu mando o recibo aqui, mesmo que não exista novidade.',
  unavailable:
    'A verificação sob demanda ainda não foi ativada (falta o token do GitHub no Apps Script). As coletas automáticas continuam nos horários programados.',
  failed:
    'O GitHub não aceitou o pedido agora. Tenta de novo em alguns minutos; as verificações automáticas continuam.',
};
