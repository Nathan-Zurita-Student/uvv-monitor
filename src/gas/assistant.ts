/**
 * Assistente acadêmico no Apps Script: liga o agente (src/assistant) à OpenAI, à Google Agenda,
 * ao Gmail e à planilha, controla o orçamento, guarda o contexto da conversa e registra logs.
 */
import { buildAgenda } from '../agenda/agenda.js';
import {
  ASSISTANT_MODEL,
  AssistantError,
  costOf,
  redact,
  reservationFor,
  runAgent,
  turnContext,
  type ConversationTurn,
  type ModelCaller,
  type ModelResponse,
  type Reference,
} from '../assistant/agent.js';
import { classCancellations, classesTodayText } from '../assistant/classes.js';
import { localTime } from '../assistant/dates.js';
import { computeInsights } from '../assistant/insights.js';
import {
  memoryFromRow,
  memoryToRow,
  personalReminderFromRow,
  personalReminderToRow,
} from '../assistant/memory.js';
import {
  executePendingAction,
  ToolRunner,
  type AssistantDeps,
  type DocumentsPort,
} from '../assistant/tools.js';
import type { Insight, PendingAction } from '../assistant/types.js';
import { itemLabel } from '../bot/activity.js';
import { encodeCallback } from '../bot/callbacks.js';
import type { Keyboard } from '../bot/screens.js';
import { userStatusToRow } from '../persistence/rows.js';
import { escapeHtml } from '../telegram/html.js';
import { localDateKey } from '../utils/dates.js';
import { GasCalendar, GasGmail } from './google-api.js';
import { SheetStore } from './sheet-store.js';
import {
  classesOf,
  filesOf,
  itemsOf,
  persist,
  readSnapshot,
  buildSnapshot,
  type SheetWrite,
  type Snapshot,
} from './snapshot.js';
import { sendFilesById, sendHtml, typing, type BotProperties } from './telegram-api.js';

export interface AssistantEnv {
  props: BotProperties;
  snapshot: Snapshot;
  now: Date;
}

// ---------------------------------------------------------------------------------------------
// Configuração e orçamento

const USAGE_KEY = 'GPT_CHAT_USAGE';
const HISTORY_KEY = 'GPT_CHAT_HISTORY';
const PENDING_KEY = 'assistant.pending';
const BUSY_KEY = 'assistant.busy';

interface UsageState {
  month: string;
  spent: number;
  day: string;
  callsToday: number;
}

function scriptProps() {
  return PropertiesService.getScriptProperties();
}

function setting(name: string, fallback: number): number {
  const raw = scriptProps().getProperty(name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new AssistantError(`Configuração inválida: ${name}.`);
  return value;
}

function usageAt(now: Date): UsageState {
  const day = localDateKey(now);
  const month = day.slice(0, 7);
  const raw = scriptProps().getProperty(USAGE_KEY);
  if (!raw) return { month, spent: 0, day, callsToday: 0 };
  const usage = JSON.parse(raw) as UsageState;
  if (!Number.isFinite(usage.spent) || usage.spent < 0 || !Number.isInteger(usage.callsToday)) {
    throw new AssistantError(
      'Não consegui conferir o controle de gastos. Nenhuma chamada foi feita.',
    );
  }
  return {
    month,
    spent: usage.month === month ? usage.spent : 0,
    day,
    callsToday: usage.day === day ? usage.callsToday : 0,
  };
}

function saveUsage(usage: UsageState): void {
  scriptProps().setProperty(USAGE_KEY, JSON.stringify(usage));
}

export function budgetSummary(now: Date): string {
  const usage = usageAt(now);
  const limit = setting('GPT_CHAT_MONTHLY_BUDGET_USD', 2.5);
  return `💵 GPT neste mês: US$ ${usage.spent.toFixed(4)} de US$ ${limit.toFixed(2)}.\nHoje: ${String(usage.callsToday)} conversas.\nEsse contador é deste bot e não consulta seu saldo na OpenAI.`;
}

/** Chamada à OpenAI com reserva de orçamento antes e acerto pelo consumo real depois. */
function openAiCaller(env: AssistantEnv, key: string): ModelCaller {
  let first = true;
  return (request) => {
    if (!first) typing(env.props);
    first = false;
    const reserve = reservationFor(request);
    const usage = usageAt(env.now);
    if (usage.spent + reserve > setting('GPT_CHAT_MONTHLY_BUDGET_USD', 2.5))
      throw new AssistantError(
        'Cheguei ao limite de gasto do GPT deste mês. Os botões, comandos e lembretes continuam funcionando. Use /gastos para conferir.',
      );
    const reserved = { ...usage, spent: usage.spent + reserve };
    saveUsage(reserved);
    const send = () =>
      UrlFetchApp.fetch('https://api.openai.com/v1/responses', {
        method: 'post',
        contentType: 'application/json',
        headers: { authorization: `Bearer ${key}` },
        payload: JSON.stringify(request),
        muteHttpExceptions: true,
      });
    let response = send();
    // Instabilidade passageira da OpenAI: uma nova tentativa antes de desistir.
    if (response.getResponseCode() >= 500) {
      typing(env.props);
      response = send();
    }
    const status = response.getResponseCode();
    if (status >= 400) {
      saveUsage({ ...reserved, spent: Math.max(0, reserved.spent - reserve) });
      // O corpo de erro da OpenAI não contém a chave; registra um trecho para diagnóstico.
      console.error(`OpenAI HTTP ${String(status)}: ${response.getContentText().slice(0, 400)}`);
      if (status === 401)
        throw new AssistantError('A chave da OpenAI foi recusada. Confira a configuração do bot.');
      if (status === 429)
        throw new AssistantError(
          'A OpenAI está limitando os pedidos agora (ou o crédito acabou). Tenta de novo em alguns minutos.',
        );
      throw new AssistantError(
        `O GPT não respondeu (HTTP ${String(status)}). Tenta de novo daqui a pouco.`,
      );
    }
    const payload = JSON.parse(response.getContentText()) as ModelResponse;
    const cost = costOf({
      input: payload.usage?.input_tokens ?? 0,
      cached: payload.usage?.input_tokens_details?.cached_tokens ?? 0,
      output: payload.usage?.output_tokens ?? 0,
    });
    saveUsage({ ...reserved, spent: Math.max(0, reserved.spent - reserve + cost) });
    return payload;
  };
}

// ---------------------------------------------------------------------------------------------
// Contexto da conversa (memória curta) e confirmações pendentes

interface Session {
  updatedAt: string;
  turns: ConversationTurn[];
  /** Alertas já mencionados → quando (não repetir no mesmo dia). */
  alerts?: Record<string, string>;
}

function readSession(now: Date): Session {
  const raw = scriptProps().getProperty(HISTORY_KEY);
  const empty: Session = { updatedAt: now.toISOString(), turns: [], alerts: {} };
  if (!raw) return empty;
  try {
    const stored = JSON.parse(raw) as Session;
    const fresh = now.getTime() - Date.parse(stored.updatedAt) <= 48 * 60 * 60_000;
    const alerts = Object.fromEntries(
      Object.entries(stored.alerts ?? {}).filter(
        ([, at]) => now.getTime() - Date.parse(at) < 24 * 60 * 60_000,
      ),
    );
    return {
      updatedAt: stored.updatedAt,
      turns: fresh
        ? (stored.turns ?? [])
            .filter(
              (turn) => ['user', 'assistant'].includes(turn.role) && typeof turn.text === 'string',
            )
            .slice(-6)
        : [],
      alerts,
    };
  } catch {
    return empty;
  }
}

function writeSession(session: Session): void {
  let turns = session.turns.slice(-6).map((turn) => ({ ...turn, text: turn.text.slice(0, 900) }));
  let encoded = JSON.stringify({ ...session, turns });
  // Propriedades do Apps Script aceitam ~9 KB por valor.
  while (
    encodeURIComponent(encoded).replace(/%[A-F\d]{2}/gi, 'x').length > 8000 &&
    turns.length > 2
  ) {
    turns = turns.slice(2);
    encoded = JSON.stringify({ ...session, turns });
  }
  scriptProps().setProperty(HISTORY_KEY, encoded);
}

function appendTurns(
  now: Date,
  user: string,
  reply: string,
  refs: Reference[] = [],
  mentioned: string[] = [],
): void {
  const session = readSession(now);
  session.turns.push(
    { role: 'user', text: user },
    { role: 'assistant', text: reply, refs: refs.slice(0, 8) },
  );
  session.updatedAt = now.toISOString();
  session.alerts = {
    ...session.alerts,
    ...Object.fromEntries(mentioned.map((key) => [key, now.toISOString()])),
  };
  writeSession(session);
}

export function forgetConversation(): void {
  scriptProps().deleteProperty(HISTORY_KEY);
  CacheService.getScriptCache().remove(PENDING_KEY);
}

function readPending(): PendingAction | undefined {
  const raw = CacheService.getScriptCache().get(PENDING_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as PendingAction;
  } catch {
    return undefined;
  }
}

function confirmKeyboard(action: PendingAction): Keyboard {
  return [
    [
      {
        text: '✅ Confirmar',
        callback_data: encodeCallback({ type: 'confirm', actionId: action.id, accept: true }),
      },
      {
        text: '✖️ Cancelar',
        callback_data: encodeCallback({ type: 'confirm', actionId: action.id, accept: false }),
      },
    ],
  ];
}

// ---------------------------------------------------------------------------------------------
// Gravações e dependências das ferramentas

function withLock<T>(work: () => T): T {
  const lock = LockService.getScriptLock();
  lock.waitLock(20_000);
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

/** Grava já (com o lock) e atualiza a cópia em cache a partir da versão mais recente. */
function persistNow(env: AssistantEnv, writes: SheetWrite[]): void {
  if (writes.length === 0) return;
  env.snapshot = withLock(() =>
    persist(writes, readSnapshot() ?? buildSnapshot(env.props.sheetId), env.props.sheetId),
  );
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-10);
}

function calendar(): GasCalendar {
  return new GasCalendar(scriptProps().getProperty('GOOGLE_CALENDAR_ID') || 'primary');
}

function buildDeps(env: AssistantEnv): AssistantDeps {
  const items = itemsOf(env.snapshot);
  return {
    now: env.now,
    chatId: env.props.chatId,
    items,
    userStatusIds: new Set(env.snapshot.statuses.map((row) => row[0] ?? '')),
    memory: env.snapshot.memory.flatMap((row) => memoryFromRow(row) ?? []),
    reminders: env.snapshot.personal.flatMap((row) => personalReminderFromRow(row) ?? []),
    classes: classesOf(env.snapshot),
    documents: documentsPort(env),
    calendar: calendar(),
    gmail: new GasGmail(),
    store: {
      setStatus: (record) =>
        persistNow(env, [{ table: 'user_task_status', row: userStatusToRow(record) }]),
      saveReminder: (reminder) =>
        persistNow(env, [{ table: 'personal_reminders', row: personalReminderToRow(reminder) }]),
      saveMemory: (fact) =>
        persistNow(env, [{ table: 'assistant_memory', row: memoryToRow(fact) }]),
      deleteMemory: (id) =>
        persistNow(env, [{ table: 'assistant_memory', row: [id], remove: true }]),
    },
    requestConfirmation: (action) =>
      CacheService.getScriptCache().put(PENDING_KEY, JSON.stringify(action), 3600),
    newId,
  };
}

function todayClasses(env: AssistantEnv): { classesToday?: string } {
  const text = classesTodayText(
    classesOf(env.snapshot),
    classCancellations(itemsOf(env.snapshot), env.now),
    env.now,
  );
  return text ? { classesToday: text } : {};
}

/** Arquivos dos professores: a lista vem da cópia em cache; reenviar usa o file_id do Telegram. */
function documentsPort(env: AssistantEnv): DocumentsPort {
  return {
    list: () => filesOf(env.snapshot),
    send: (files) => sendFilesById(env.props, files),
  };
}

function currentAlerts(env: AssistantEnv): Insight[] {
  return computeInsights({ agenda: buildAgenda(itemsOf(env.snapshot), env.now), now: env.now });
}

function logTurn(
  env: AssistantEnv,
  entry: {
    id: string;
    question: string;
    tools: string;
    rounds: number;
    model: string;
    usage?: { input: number; cached: number; output: number };
    latencyMs: number;
    outcome: string;
    reply: string;
  },
): void {
  const cost = entry.usage ? costOf(entry.usage) : 0;
  const record = {
    ...entry,
    question: redact(entry.question).slice(0, 300),
    reply: redact(entry.reply).slice(0, 300),
    costUsd: Number(cost.toFixed(6)),
  };
  console.log(JSON.stringify({ assistant: record }));
  try {
    SheetStore.open(env.props.sheetId).append('assistant_log', [
      record.id,
      env.now.toISOString(),
      record.question,
      record.tools,
      record.rounds,
      record.model,
      record.usage?.input ?? 0,
      record.usage?.cached ?? 0,
      record.usage?.output ?? 0,
      record.costUsd,
      record.latencyMs,
      record.outcome,
      record.reply,
    ]);
  } catch (error) {
    console.error(`Log do assistente não gravado: ${String(error)}`);
  }
}

/** Espera outra conversa em andamento terminar (o histórico é um só). */
function waitTurn(): void {
  const cache = CacheService.getScriptCache();
  for (let attempt = 0; attempt < 45 && cache.get(BUSY_KEY); attempt += 1) Utilities.sleep(1000);
  cache.put(BUSY_KEY, '1', 90);
}

// ---------------------------------------------------------------------------------------------
// Conversa

const yes =
  /^(sim|s|pode|pode sim|confirmo|confirma|confirmar|ok|beleza|isso|manda ver|faz isso)[!. ]*$/i;
const no = /^(n[aã]o|cancela|cancelar|deixa|deixa pra l[aá]|esquece)[!. ]*$/i;

export interface AssistantReply {
  html: string;
  keyboard?: Keyboard;
}

/** Atende uma mensagem livre do usuário (ou um pedido vindo de botão). */
export function assistantReply(
  env: AssistantEnv,
  input: { text: string; updateId: number; replyContext?: string },
): AssistantReply {
  const text = input.text.trim();
  const command = text.toLowerCase();
  if (/^\/gastos(?:@\w+)?$/.test(command)) return { html: escapeHtml(budgetSummary(env.now)) };
  if (/^\/(?:esquecer|cancelar)(?:@\w+)?$/.test(command)) {
    forgetConversation();
    return {
      html: 'Tudo bem, esqueci o contexto da nossa conversa. Lembretes e memória continuam valendo.',
    };
  }

  const pending = readPending();
  if (pending && (yes.test(text) || no.test(text))) {
    const reply = resolvePending(env, pending, yes.test(text));
    appendTurns(env.now, text, reply);
    return { html: escapeHtml(reply) };
  }

  const props = scriptProps();
  const key = props.getProperty('OPENAI_API_KEY');
  if (!key)
    return {
      html: 'A conversa ainda precisa da chave OpenAI nas propriedades do bot. Os comandos e botões continuam disponíveis.',
    };
  if (props.getProperty('GPT_CHAT_ENABLED') === 'false')
    return { html: 'A conversa com o GPT está pausada. Use /painel para ver suas atividades.' };
  if (text.length > 2500)
    return {
      html: 'Me manda esse pedido em até 2500 caracteres, que fica mais fácil de eu entender.',
    };

  const started = Date.now();
  const model = props.getProperty('GPT_MODEL') || ASSISTANT_MODEL;
  const runner = new ToolRunner(buildDeps(env));
  waitTurn();
  try {
    const usage = usageAt(env.now);
    if (usage.callsToday >= setting('GPT_CHAT_MAX_CALLS_PER_DAY', 40)) {
      return {
        html: 'Cheguei ao limite de conversas de hoje. Amanhã volta ao normal; os botões e lembretes continuam funcionando.',
      };
    }
    saveUsage({ ...usage, callsToday: usage.callsToday + 1 });
    typing(env.props);
    const session = readSession(env.now);
    const alerts = currentAlerts(env);
    const mentioned = Object.keys(session.alerts ?? {});
    const context = turnContext(
      {
        now: env.now,
        memory: env.snapshot.memory.flatMap((row) => memoryFromRow(row) ?? []),
        alerts,
        mentionedAlerts: mentioned,
        ...(pending ? { pending } : {}),
        ...(input.replyContext ? { replyContext: input.replyContext } : {}),
        ...(env.snapshot.lastSyncAt ? { lastSyncAt: env.snapshot.lastSyncAt } : {}),
        ...todayClasses(env),
      },
      session.turns,
    );
    const result = runAgent(
      {
        text,
        history: session.turns,
        context,
        model,
        reasoningEffort: props.getProperty('GPT_REASONING_EFFORT') || 'low',
      },
      runner,
      openAiCaller(env, key),
    );
    const reply = result.reply.trim() || 'Pode repetir? Não entendi bem.';
    const refIds = new Set(result.referenced.map((ref) => ref.id));
    const given = alerts.filter((alert) => !mentioned.includes(alert.key)).slice(0, 3);
    const nowMentioned = given
      .filter(
        (alert, index) =>
          alert.itemIds.some((id) => refIds.has(id)) || (index === 0 && /\baliás\b/i.test(reply)),
      )
      .map((alert) => alert.key);
    appendTurns(env.now, text, reply, result.referenced, nowMentioned);
    logTurn(env, {
      id: String(input.updateId),
      question: text,
      tools: JSON.stringify(runner.trace.map((call) => `${call.name}${call.ok ? '' : '!'}`)),
      rounds: result.rounds,
      model,
      usage: result.usage,
      latencyMs: Date.now() - started,
      outcome: runner.pending ? 'aguardando confirmação' : 'ok',
      reply,
    });
    return {
      html: escapeHtml(reply),
      ...(runner.pending ? { keyboard: confirmKeyboard(runner.pending) } : {}),
    };
  } catch (error) {
    const message =
      error instanceof AssistantError
        ? error.message
        : 'Não consegui responder agora. Tenta de novo daqui a pouco?';
    logTurn(env, {
      id: String(input.updateId),
      question: text,
      tools: JSON.stringify(runner.trace.map((call) => `${call.name}${call.ok ? '' : '!'}`)),
      rounds: 0,
      model,
      latencyMs: Date.now() - started,
      outcome: `erro: ${error instanceof Error ? error.message.slice(0, 200) : 'desconhecido'}`,
      reply: message,
    });
    return { html: escapeHtml(message) };
  } finally {
    CacheService.getScriptCache().remove(BUSY_KEY);
  }
}

function resolvePending(env: AssistantEnv, action: PendingAction, accept: boolean): string {
  CacheService.getScriptCache().remove(PENDING_KEY);
  if (!accept) return 'Beleza, deixei como estava.';
  const deps = buildDeps(env);
  try {
    return executePendingAction(action, deps);
  } catch (error) {
    console.error(`Ação confirmada falhou: ${String(error)}`);
    return 'Não consegui fazer essa alteração agora. Nada foi mudado; tenta de novo daqui a pouco?';
  }
}

/** Botão Confirmar/Cancelar de uma ação preparada pelo assistente. */
export function confirmFromButton(env: AssistantEnv, actionId: string, accept: boolean): string {
  const pending = readPending();
  if (!pending || pending.id !== actionId)
    return 'Essa confirmação expirou. Me pede de novo, por favor.';
  const reply = resolvePending(env, pending, accept);
  appendTurns(env.now, accept ? 'Confirmar' : 'Cancelar', reply);
  return reply;
}

/** Botão "Organizar estudo" dos avisos proativos: vira um pedido ao assistente. */
export function assistPrompt(env: AssistantEnv, itemId: string): string | undefined {
  const item = itemsOf(env.snapshot).find((candidate) => candidate.id === itemId);
  if (!item) return undefined;
  return `Organiza um horário de estudo pra ${itemLabel(item)} [${item.id}] nos meus horários livres antes dela e me pergunta antes de colocar na agenda.`;
}

// ---------------------------------------------------------------------------------------------
// Acionador de 5 minutos: lembretes pessoais e o aviso proativo do dia

/** Envia lembretes pessoais vencidos e devolve as gravações (enviado/cancelado). */
export function sendDuePersonalReminders(env: AssistantEnv): SheetWrite[] {
  const items = new Map(itemsOf(env.snapshot).map((item) => [item.id, item]));
  const writes: SheetWrite[] = [];
  for (const reminder of env.snapshot.personal.flatMap(
    (row) => personalReminderFromRow(row) ?? [],
  )) {
    if (
      reminder.chatId !== env.props.chatId ||
      reminder.sentAt ||
      Date.parse(reminder.remindAt) > env.now.getTime()
    )
      continue;
    const item = reminder.itemId ? items.get(reminder.itemId) : undefined;
    if (!item || !['DONE', 'IGNORED'].includes(item.status)) {
      try {
        sendHtml(
          env.props,
          `${reminder.urgent ? '🔴 <b>Lembrete urgente</b>' : '⏰ <b>Seu lembrete</b>'}\n\n<b>${escapeHtml(reminder.title)}</b>${reminder.description && reminder.description !== reminder.title ? `\n${escapeHtml(reminder.description)}` : ''}`,
        );
      } catch (error) {
        // Fica para o próximo acionador.
        console.error(`Lembrete pessoal não enviado: ${String(error)}`);
        continue;
      }
    }
    writes.push({
      table: 'personal_reminders',
      row: personalReminderToRow({ ...reminder, sentAt: env.now.toISOString() }),
    });
  }
  return writes;
}

const proactiveKinds = new Set<Insight['kind']>([
  'exam_without_study',
  'exam_soon',
  'due_soon',
  'overdue',
  'same_day',
  'overlap',
  'crunch',
]);

/** Já é hora do aviso proativo de hoje? (leitura barata, sem abrir a planilha) */
export function proactiveDue(now: Date): boolean {
  const props = scriptProps();
  if (props.getProperty('ASSISTANT_PROACTIVE') === 'false') return false;
  const hour = Number(localTime(now).slice(0, 2));
  const startHour = setting('ASSISTANT_PROACTIVE_HOUR', 9);
  return (
    hour >= startHour &&
    hour < 21 &&
    props.getProperty('ASSISTANT_PROACTIVE_DAY') !== localDateKey(now)
  );
}

/**
 * Um aviso proativo por dia (a partir das 9h): prova chegando sem estudo marcado, prazo vencendo
 * com a tarefa pendente, entregas no mesmo dia... Nunca repete o mesmo aviso.
 */
export function proactiveNudge(env: AssistantEnv): void {
  if (!proactiveDue(env.now)) return;
  const props = scriptProps();
  const today = localDateKey(env.now);
  props.setProperty('ASSISTANT_PROACTIVE_DAY', today);
  const sentRaw = props.getProperty('ASSISTANT_PROACTIVE_SENT');
  const sent = Object.fromEntries(
    Object.entries((sentRaw ? JSON.parse(sentRaw) : {}) as Record<string, string>).filter(
      ([, day]) => env.now.getTime() - Date.parse(`${day}T12:00:00-03:00`) < 10 * 86_400_000,
    ),
  );
  const items = itemsOf(env.snapshot);
  let events;
  try {
    events = calendar().list(env.now, new Date(env.now.getTime() + 8 * 86_400_000));
  } catch (error) {
    console.error(`Agenda indisponível no aviso proativo: ${String(error)}`);
  }
  const insight = computeInsights({
    agenda: buildAgenda(items, env.now),
    now: env.now,
    ...(events ? { events } : {}),
  }).find((candidate) => proactiveKinds.has(candidate.kind) && !sent[candidate.key]);
  if (!insight) return;
  const itemId = insight.itemIds[0];
  let text = `💡 ${escapeHtml(insight.text)}`;
  let keyboard: Keyboard;
  if ((insight.kind === 'exam_without_study' || insight.kind === 'exam_soon') && itemId) {
    text += '\nQuer que eu organize um horário de estudo pra você?';
    keyboard = [
      [
        {
          text: '📚 Organizar estudo',
          callback_data: encodeCallback({ type: 'assist', itemId, intent: 'study' }),
        },
        { text: 'Agora não', callback_data: encodeCallback({ type: 'noop' }) },
      ],
    ];
  } else if ((insight.kind === 'due_soon' || insight.kind === 'overdue') && itemId) {
    keyboard = [
      [
        {
          text: '✅ Já fiz',
          callback_data: encodeCallback({
            type: 'status',
            itemId,
            status: 'DONE',
            undo: false,
            screen: { kind: 'card', context: 'reminder' },
          }),
        },
        {
          text: '⏰ Lembrar depois',
          callback_data: encodeCallback({
            type: 'remindMenu',
            itemId,
            screen: { kind: 'card', context: 'reminder' },
          }),
        },
      ],
    ];
  } else {
    keyboard = [
      [
        {
          text: '📆 Ver minha semana',
          callback_data: encodeCallback({ type: 'view', view: 'week', refresh: false }),
        },
      ],
    ];
  }
  sendHtml(env.props, text, keyboard);
  sent[insight.key] = today;
  props.setProperty('ASSISTANT_PROACTIVE_SENT', JSON.stringify(sent));
}

/** Diagnóstico sem revelar a chave nem gastar tokens. */
export function conversationInfo(): string {
  const props = scriptProps();
  return JSON.stringify({
    model: props.getProperty('GPT_MODEL') || ASSISTANT_MODEL,
    reasoningEffort: props.getProperty('GPT_REASONING_EFFORT') || 'low',
    keyConfigured: Boolean(props.getProperty('OPENAI_API_KEY')),
    googleConfigured: Boolean(props.getProperty('GOOGLE_REFRESH_TOKEN')),
    enabled: props.getProperty('GPT_CHAT_ENABLED') !== 'false',
    proactive: props.getProperty('ASSISTANT_PROACTIVE') !== 'false',
    monthlyBudgetUsd: setting('GPT_CHAT_MONTHLY_BUDGET_USD', 2.5),
    usage: usageAt(new Date()),
  });
}

export function sendReply(env: AssistantEnv, reply: AssistantReply): void {
  sendHtml(env.props, reply.html, reply.keyboard);
}
