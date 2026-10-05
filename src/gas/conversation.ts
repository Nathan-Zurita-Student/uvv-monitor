import {
  CHAT_MODEL,
  conversationRequest,
  conversationReservation,
  conversationReminderDate,
  parseConversationPlan,
  readConversationResponse,
  type ConversationPlan,
  type ConversationTurn,
} from '../bot/conversation.js';
import { userStatusRecord } from '../bot/status.js';
import type { AcademicItem } from '../models/academic-item.js';
import { userStatusToRow, type TableName } from '../persistence/rows.js';
import { escapeHtml } from '../telegram/html.js';
import { localDateKey } from '../utils/dates.js';
import { conversationCalendarToken } from './configuration.js';

export interface ConversationStore {
  rows(name: TableName): string[][];
  upsert(name: TableName, row: string[]): void;
}

interface Usage {
  month: string;
  spent: number;
  day: string;
  callsToday: number;
}

interface ChatSession {
  updatedAt: string;
  turns: ConversationTurn[];
}

export interface ConversationInput {
  text: string;
  updateId: number;
  chatId: string;
  items: AcademicItem[];
  now: Date;
  store: ConversationStore;
  replyContext?: string;
}

const USAGE_KEY = 'GPT_CHAT_USAGE';
const HISTORY_KEY = 'GPT_CHAT_HISTORY';

function usageAt(now: Date): Usage {
  const day = localDateKey(now);
  const month = day.slice(0, 7);
  const raw = PropertiesService.getScriptProperties().getProperty(USAGE_KEY);
  if (!raw) return { month, spent: 0, day, callsToday: 0 };
  const usage = JSON.parse(raw) as Usage;
  if (!Number.isFinite(usage.spent) || usage.spent < 0 || !Number.isInteger(usage.callsToday)) {
    throw new Error('Não consegui conferir o controle de gastos. Nenhuma chamada foi feita.');
  }
  return {
    month,
    spent: usage.month === month ? usage.spent : 0,
    day,
    callsToday: usage.day === day ? usage.callsToday : 0,
  };
}

function saveUsage(usage: Usage): void {
  PropertiesService.getScriptProperties().setProperty(USAGE_KEY, JSON.stringify(usage));
}

function session(now: Date): ConversationTurn[] {
  const raw = PropertiesService.getScriptProperties().getProperty(HISTORY_KEY);
  if (!raw) return [];
  try {
    const stored = JSON.parse(raw) as ChatSession;
    if (now.getTime() - Date.parse(stored.updatedAt) > 48 * 60 * 60_000) return [];
    return stored.turns
      .filter((turn) => ['user', 'assistant'].includes(turn.role) && typeof turn.text === 'string')
      .slice(-6);
  } catch {
    return [];
  }
}

function remember(text: string, reply: string, now: Date): void {
  let turns: ConversationTurn[] = [
    ...session(now),
    { role: 'user', text: text.slice(0, 850) },
    { role: 'assistant', text: reply.slice(0, 850) },
  ];
  turns = turns.slice(-6);
  let encoded = JSON.stringify({ updatedAt: now.toISOString(), turns });
  while (
    encodeURIComponent(encoded).replace(/%[A-F\d]{2}/gi, 'x').length > 8000 &&
    turns.length > 2
  ) {
    turns = turns.slice(2);
    encoded = JSON.stringify({ updatedAt: now.toISOString(), turns });
  }
  PropertiesService.getScriptProperties().setProperty(HISTORY_KEY, encoded);
}

function positiveSetting(name: string, defaultValue: number): number {
  const raw = PropertiesService.getScriptProperties().getProperty(name);
  const value = raw === null ? defaultValue : Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Configuração inválida: ${name}.`);
  return value;
}

function budgetSummary(now: Date): string {
  const usage = usageAt(now);
  const limit = positiveSetting('GPT_CHAT_MONTHLY_BUDGET_USD', 2.5);
  return `💵 GPT neste mês: US$ ${usage.spent.toFixed(4)} de US$ ${limit.toFixed(2)}.\nHoje: ${usage.callsToday} pedidos.\nEsse contador é deste bot, não consulta seu saldo na OpenAI. Falhas sem consumo conhecido mantêm uma reserva conservadora.`;
}

function askGpt(input: ConversationInput): ConversationPlan {
  const properties = PropertiesService.getScriptProperties();
  const key = properties.getProperty('OPENAI_API_KEY');
  if (!key)
    throw new Error(
      'A conversa ainda precisa da chave OpenAI nas propriedades do bot. Os comandos e botões continuam disponíveis.',
    );
  if (properties.getProperty('GPT_CHAT_ENABLED') === 'false')
    throw new Error('A conversa com GPT está pausada. Use /painel para ver suas atividades.');
  if (input.text.length > 2500)
    throw new Error('Me manda esse pedido em até 2500 caracteres para manter a conversa leve.');
  const personal = input.store
    .rows('personal_reminders')
    .filter((row) => row[5] === input.chatId && !row[8])
    .slice(-8)
    .map((row) => `${row[1]} — ${row[3]}${row[4] === 'true' ? ' (urgente)' : ''}`)
    .join('\n');
  const request = conversationRequest(
    input.text,
    input.items,
    session(input.now),
    input.now,
    `Mensagem à qual o usuário respondeu (apenas contexto):\n${input.replyContext?.slice(0, 1500) ?? ''}\nLembretes pessoais ativos:\n${personal}`,
  );
  const reserve = conversationReservation(request);
  const usage = usageAt(input.now);
  const monthlyLimit = positiveSetting('GPT_CHAT_MONTHLY_BUDGET_USD', 2.5);
  const dailyLimit = positiveSetting('GPT_CHAT_MAX_CALLS_PER_DAY', 30);
  if (usage.spent + reserve > monthlyLimit)
    throw new Error(
      'Cheguei ao limite de gasto do GPT deste mês. Seus lembretes, comandos e botões continuam funcionando. Use /gastos para conferir.',
    );
  if (usage.callsToday >= dailyLimit)
    throw new Error(
      'Cheguei ao limite de conversas de hoje. Amanhã volta ao normal; os comandos e lembretes continuam funcionando.',
    );
  const reserved = { ...usage, spent: usage.spent + reserve, callsToday: usage.callsToday + 1 };
  saveUsage(reserved);
  const response = UrlFetchApp.fetch('https://api.openai.com/v1/responses', {
    method: 'post',
    contentType: 'application/json',
    headers: { authorization: `Bearer ${key}` },
    payload: JSON.stringify(request),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 400) {
    // Não expõe a chave nem o corpo da resposta do provedor em logs/mensagens.
    throw new Error(
      `O GPT não respondeu (HTTP ${response.getResponseCode()}). Tente novamente mais tarde. Nenhuma ação foi executada.`,
    );
  }
  const result = readConversationResponse(JSON.parse(response.getContentText()));
  saveUsage({ ...reserved, spent: Math.max(0, reserved.spent - reserve + result.cost) });
  return result.plan;
}

function createCalendarEvent(input: ConversationInput, plan: ConversationPlan, at: Date): string {
  const calendarId =
    PropertiesService.getScriptProperties().getProperty('GOOGLE_CALENDAR_ID') || 'primary';
  const id = `uvv${String(input.updateId)}`;
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const params = {
    headers: { authorization: `Bearer ${conversationCalendarToken()}` },
    muteHttpExceptions: true,
  };
  const response = UrlFetchApp.fetch(base, {
    ...params,
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      id,
      summary: `${plan.urgent ? '🔴 URGENTE — ' : ''}${plan.title}`,
      description: `${plan.description}\n\nLembrete pessoal solicitado no Telegram. Não altera prazos oficiais da faculdade.`,
      start: { dateTime: at.toISOString(), timeZone: 'America/Sao_Paulo' },
      end: {
        dateTime: new Date(at.getTime() + plan.durationMinutes * 60_000).toISOString(),
        timeZone: 'America/Sao_Paulo',
      },
      ...(plan.urgent ? { colorId: '11' } : {}),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 0 },
          { method: 'popup', minutes: 10 },
        ],
      },
      extendedProperties: {
        private: { uvvTelegramUpdate: String(input.updateId), uvvChatId: input.chatId },
      },
    }),
  });
  if (response.getResponseCode() === 409) {
    // Reentrega do Telegram depois de um timeout: usa o mesmo ID, sem duplicar o evento.
    const existing = UrlFetchApp.fetch(`${base}/${id}`, { ...params, method: 'get' });
    const event = JSON.parse(existing.getContentText()) as {
      id?: string;
      extendedProperties?: { private?: Record<string, string> };
    };
    if (
      existing.getResponseCode() === 200 &&
      event.extendedProperties?.private?.uvvChatId === input.chatId &&
      event.extendedProperties.private.uvvTelegramUpdate === String(input.updateId)
    )
      return id;
  }
  if (response.getResponseCode() >= 400)
    throw new Error(
      'Não consegui gravar na sua agenda. Confira a autorização do Google Calendar no Apps Script. Ainda não confirmei esse lembrete.',
    );
  const event = JSON.parse(response.getContentText()) as { id?: string };
  if (!event.id) throw new Error('A agenda não confirmou a criação. Tente novamente mais tarde.');
  return event.id;
}

function executePlan(input: ConversationInput, plan: ConversationPlan): string {
  if (plan.action === 'reply') return plan.reply || 'O que você quer organizar hoje?';
  const item = plan.itemId ? input.items.find((entry) => entry.id === plan.itemId) : undefined;
  if (plan.itemId && !item)
    throw new Error('Não encontrei essa atividade. Me diga o nome ou use /painel.');
  if (plan.action === 'set_status') {
    input.store.upsert(
      'user_task_status',
      userStatusToRow(
        userStatusRecord(item!.id, plan.status!, item!.status, input.now.toISOString()),
      ),
    );
    const status =
      plan.status === 'DONE' ? 'concluída' : plan.status === 'IGNORED' ? 'ignorada' : 'reaberta';
    return `👍 Marquei “${item!.title}” como ${status}.`;
  }
  const at = conversationReminderDate(plan, input.now);
  const eventId = plan.calendar ? createCalendarEvent(input, plan, at) : '';
  input.store.upsert('personal_reminders', [
    `GPT-${input.updateId}`,
    plan.title!,
    plan.description!,
    at.toISOString(),
    String(plan.urgent),
    input.chatId,
    plan.itemId ?? '',
    eventId,
    '',
  ]);
  const when = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  return `${plan.urgent ? '🔴 Lembrete urgente combinado!' : '⏰ Combinado!'} ${plan.calendar ? 'Criei na sua agenda e vou te avisar aqui' : 'Vou te avisar aqui'} em ${when}.\n\n${plan.title}\n${plan.description}`;
}

/** Chamado com o lock do webhook: reserva gastos, mantém memória e executa uma ação por update. */
export function handleConversation(input: ConversationInput): { reply: string; replay: boolean } {
  const command = input.text.trim().toLowerCase();
  if (/^\/gastos(?:@\w+)?$/.test(command))
    return { reply: budgetSummary(input.now), replay: false };
  if (/^\/(?:esquecer|cancelar)(?:@\w+)?$/.test(command)) {
    PropertiesService.getScriptProperties().deleteProperty(HISTORY_KEY);
    return {
      reply:
        'Tudo bem, esqueci o contexto da conversa. Seus lembretes já criados continuam valendo.',
      replay: false,
    };
  }
  const saved = input.store
    .rows('conversation_operations')
    .find((row) => row[0] === String(input.updateId));
  if (saved?.[1] === 'sent') return { reply: saved[3] ?? '', replay: true };
  if (saved?.[1] === 'completed') return { reply: saved[3] ?? '', replay: false };
  const plan = saved?.[2] ? parseConversationPlan(JSON.parse(saved[2])) : askGpt(input);
  if (!saved)
    input.store.upsert('conversation_operations', [
      String(input.updateId),
      'planned',
      JSON.stringify(plan),
      '',
      input.now.toISOString(),
    ]);
  const reply = executePlan(input, plan);
  input.store.upsert('conversation_operations', [
    String(input.updateId),
    'completed',
    JSON.stringify(plan),
    reply,
    input.now.toISOString(),
  ]);
  remember(input.text, reply, input.now);
  return { reply, replay: false };
}

export function markConversationSent(store: ConversationStore, updateId: number): void {
  const row = store.rows('conversation_operations').find((entry) => entry[0] === String(updateId));
  if (row)
    store.upsert('conversation_operations', [
      row[0]!,
      'sent',
      row[2] ?? '',
      row[3] ?? '',
      row[4] ?? '',
    ]);
}

export function sendPersonalReminders(
  store: ConversationStore,
  chatId: string,
  items: AcademicItem[],
  now: Date,
  send: (text: string) => void,
): void {
  for (const row of store.rows('personal_reminders')) {
    if (
      row[5] !== chatId ||
      row[8] ||
      !Number.isFinite(Date.parse(row[3] ?? '')) ||
      Date.parse(row[3]!) > now.getTime()
    )
      continue;
    const item = items.find((entry) => entry.id === row[6]);
    if (!item || !['DONE', 'IGNORED'].includes(item.status)) {
      send(
        `${row[4] === 'true' ? '🔴 <b>Lembrete urgente</b>' : '⏰ <b>Seu lembrete</b>'}\n\n<b>${escapeHtml(row[1] ?? '')}</b>\n${escapeHtml(row[2] ?? '')}`,
      );
    }
    // Só marca depois do envio: uma falha pode ser repetida pelo próximo acionador.
    store.upsert('personal_reminders', [...row.slice(0, 8), now.toISOString()]);
  }
}

/** Diagnóstico sem expor valores secretos nem gastar tokens. */
export function conversationInfo(): string {
  const props = PropertiesService.getScriptProperties();
  return JSON.stringify({
    model: CHAT_MODEL,
    keyConfigured: Boolean(props.getProperty('OPENAI_API_KEY')),
    enabled: props.getProperty('GPT_CHAT_ENABLED') !== 'false',
    monthlyBudgetUsd: positiveSetting('GPT_CHAT_MONTHLY_BUDGET_USD', 2.5),
    usage: usageAt(new Date()),
  });
}
