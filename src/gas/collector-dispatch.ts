/**
 * Dispara a coleta do monitor no GitHub Actions (workflow_dispatch) a partir do Apps Script.
 *
 * O agendamento do GitHub ("schedule") atrasa horas em períodos de carga; um disparo manual
 * começa assim que há máquina. O acionador de 5 minutos do Apps Script chama `scheduledDispatch`,
 * que antecipa as coletas dos resumos (12h, 17h, 20h), e o bot oferece "Verificar Portal agora".
 * Precisa de um token do GitHub com permissão só de Actions neste repositório, na propriedade
 * MONITOR_DISPATCH_TOKEN (sem ela, nada é disparado e o agendamento do GitHub continua valendo).
 */
import { localTime } from '../assistant/dates.js';
import { localDateKey } from '../utils/dates.js';

export const DISPATCH_TOKEN_PROPERTY = 'MONITOR_DISPATCH_TOKEN';
const REPOSITORY_PROPERTY = 'MONITOR_REPOSITORY';
const DEFAULT_REPOSITORY = 'Nathan-Zurita-Student/uvv-monitor';
const LAST_SLOT_PROPERTY = 'MONITOR_LAST_DISPATCH';
const TOKEN_NOTICE_PROPERTY = 'MONITOR_TOKEN_NOTICE';
const MANUAL_KEY = 'monitor.manual-dispatch';
/** Atualização pedida no bot: no máximo uma a cada 10 minutos. */
const MANUAL_COOLDOWN_SECONDS = 600;

export const collectionSlots = ['12:00', '17:00', '20:00'] as const;
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

/** "Verificar Portal agora" no bot. */
export function manualDispatch(): ManualDispatch {
  if (!dispatchConfigured()) return 'unavailable';
  const cache = CacheService.getScriptCache();
  if (cache.get(MANUAL_KEY)) return 'recent';
  if (dispatchCollection('17:00') !== 'ok') return 'failed';
  cache.put(MANUAL_KEY, '1', MANUAL_COOLDOWN_SECONDS);
  return 'started';
}

export const manualDispatchText: Record<ManualDispatch, string> = {
  started:
    '🔄 Fui verificar o Portal, o AVA e seus e-mails agora. Em uns 5 minutos chega aqui o que tiver de novo (arquivos dos professores inclusive).',
  recent: '🔄 Já estou verificando o Portal; daqui a pouco chega o que tiver de novo.',
  unavailable:
    'A verificação sob demanda ainda não foi ativada (falta o token do GitHub no Apps Script). As coletas automáticas continuam antes dos resumos das 12h, 17h e 20h.',
  failed:
    'O GitHub não aceitou o pedido agora. Tenta de novo em alguns minutos; as verificações automáticas continuam.',
};
