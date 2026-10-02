import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/env.js';
import {
  requireGoogleCredentials,
  requirePortalCredentials,
  requireTelegramCredentials,
} from '../config/env.js';
import { buildAgenda } from '../agenda/agenda.js';
import { planNotifications } from '../bot/notifications.js';
import { createRenderContext } from '../bot/screens.js';
import { applyUserStatuses } from '../bot/status.js';
import { GoogleCalendarGateway } from '../calendar/google-gateway.js';
import { isCalendarSyncCandidate, syncCalendarEvent } from '../calendar/service.js';
import { GmailGoogleGateway } from '../gmail/google-gateway.js';
import { collectRelevantGmail } from '../gmail/collector.js';
import type { RunHistory } from '../models/run.js';
import { deduplicateItems, type DetectedItemCandidate } from '../persistence/deduplication.js';
import { GoogleSheetsAcademicRepository } from '../persistence/google-sheets.js';
import { createPortalBrowserSession } from '../portal/browser.js';
import { ensurePortalAuthenticated } from '../portal/auth.js';
import { collectPortalSafely } from '../portal/safe-collector.js';
import { prioritizeItems } from '../prioritization/priority.js';
import { isMeaningfulChange } from './novelties.js';
import { verificationWindow, type DailySlot, isWeeklyReviewRun } from './windows.js';
import { TelegramClient } from '../telegram/client.js';
import { escapeHtml } from '../telegram/html.js';
import { deliverNotifications } from '../telegram/notifier.js';
import { processTelegramUpdates } from '../telegram/processor.js';
import { refreshWebhookCache } from '../telegram/webhook-cache.js';
import { logger } from '../utils/logger.js';
import { collectMoodleCalendar, reconcileEadCalendar } from '../moodle/calendar-feed.js';
import { createAiProvider, enrichItemsWithAi } from '../ai/service.js';

export async function runMonitor(
  config: AppConfig,
  slot: DailySlot,
  now = new Date(),
): Promise<void> {
  const run: RunHistory = {
    runId: randomUUID(),
    startedAt: now.toISOString(),
    portalStatus: 'NOT_STARTED',
    gmailStatus: 'NOT_STARTED',
    calendarStatus: 'NOT_STARTED',
    itemsFound: 0,
    errors: [],
  };
  const googleCredentials = requireGoogleCredentials(config);
  const telegramCredentials = requireTelegramCredentials(config);
  const repository = GoogleSheetsAcademicRepository.fromCredentials(googleCredentials);
  const telegram = new TelegramClient(telegramCredentials.botToken, telegramCredentials.chatId);
  await repository.initialize();

  if (!config.TELEGRAM_WEBHOOK_ENABLED) {
    try {
      // Com o webhook do Apps Script ativo, os cliques já foram tratados na hora (e o Telegram
      // recusaria getUpdates). Só lê a fila quando não há webhook.
      if (!(await telegram.webhookUrl())) {
        await processTelegramUpdates(telegram, repository, telegramCredentials.chatId, now);
      }
    } catch (error) {
      run.errors.push(`Telegram getUpdates: ${error instanceof Error ? error.message : 'erro'}`);
    }
  }

  const candidates: DetectedItemCandidate[] = [];
  const portalSession = await createPortalBrowserSession();
  try {
    await ensurePortalAuthenticated(portalSession.page, requirePortalCredentials(config), {
      timeoutMs: config.PORTAL_TIMEOUT_MS,
      diagnosticsDirectory: config.DIAGNOSTICS_DIR,
    });
    const portal = await collectPortalSafely(portalSession.page);
    candidates.push(...portal.items);
    run.errors.push(...portal.errors.map((error) => `Portal ${error}`));
    run.portalStatus = portal.errors.length === 0 ? 'SUCCESS' : 'PARTIAL';
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'FAILED';
    run.portalStatus = code === 'CAPTCHA_OR_MFA' ? 'NOT_VERIFIED' : 'FAILED';
    run.errors.push(`Portal: ${error instanceof Error ? error.message : 'erro'}`);
  } finally {
    await portalSession.close();
  }

  if (config.MOODLE_CALENDAR_URL) {
    try {
      const moodleCalendarItems = await collectMoodleCalendar(config.MOODLE_CALENDAR_URL);
      candidates.push(...moodleCalendarItems);
      logger.info(
        { module: 'Moodle', items: moodleCalendarItems.length },
        'Calendário EAD coletado',
      );
    } catch (error) {
      run.errors.push(`Calendário EAD: ${error instanceof Error ? error.message : 'erro'}`);
    }
    candidates.splice(0, candidates.length, ...reconcileEadCalendar(candidates));
  }

  const window = verificationWindow(now, slot);
  try {
    const gmailLookback = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    candidates.push(
      ...(await collectRelevantGmail(
        new GmailGoogleGateway(googleCredentials),
        gmailLookback < window.from ? gmailLookback : window.from,
      )),
    );
    run.gmailStatus = 'SUCCESS';
  } catch (error) {
    run.gmailStatus = 'FAILED';
    run.errors.push(`Gmail: ${error instanceof Error ? error.message : 'erro'}`);
  }

  const existing = await repository.listDetectedItems();
  const isBootstrap = existing.length === 0;
  const diff = deduplicateItems(candidates, existing, now.toISOString());
  const touched = [
    ...diff.newItems,
    ...diff.changedItems.map(({ item }) => item),
    ...diff.unchangedItems,
  ];
  // O status do usuário (Telegram) vale sobre o da fonte: concluídos não gastam análise da IA.
  let prioritized = prioritizeItems(
    applyUserStatuses(touched, await repository.listTaskStatuses()),
    now,
  );
  const meaningfulChanges = diff.changedItems.filter(({ item, changes }) =>
    isMeaningfulChange(item, changes),
  );
  const noveltyIds = new Set(
    [...diff.newItems, ...meaningfulChanges.map(({ item }) => item)].map((item) => item.id),
  );

  try {
    const ai = await enrichItemsWithAi(prioritized, createAiProvider(config), {
      maxCalls: config.AI_MAX_CALLS_PER_RUN,
      maxInputCharacters: config.AI_MAX_INPUT_CHARS,
      priorityIds: noveltyIds,
      now,
    });
    prioritized = ai.items;
    if (ai.errors.length > 0) run.errors.push(...ai.errors.map((error) => `IA: ${error}`));
    logger.info(
      { module: 'AI', calls: ai.calls, errors: ai.errors.length },
      'Análises acadêmicas processadas',
    );
  } catch (error) {
    run.errors.push(`IA: ${error instanceof Error ? error.message : 'erro'}`);
  }
  // A planilha guarda tudo o que foi coletado com o status da fonte (inclusive o que o usuário
  // concluiu, para o prazo continuar atualizado); o status do usuário fica em user_task_status.
  const sourceStatusById = new Map(touched.map((item) => [item.id, item.status]));
  const enrichedById = new Map(prioritized.map((item) => [item.id, item]));
  await repository.upsertDetectedItems(
    touched.map((item) => {
      const enriched = enrichedById.get(item.id);
      return enriched ? { ...enriched, status: item.status } : item;
    }),
  );
  run.itemsFound = candidates.length;
  // Relê os status depois da coleta: ações feitas no Telegram durante a execução não se perdem.
  const allItems = prioritizeItems(
    applyUserStatuses(await repository.listDetectedItems(), await repository.listTaskStatuses()),
    now,
  );

  const calendar = new GoogleCalendarGateway(googleCredentials, config.GOOGLE_CALENDAR_ID);
  try {
    const calendarResults: Record<string, number> = {};
    for (const item of allItems.filter(isCalendarSyncCandidate)) {
      const result = await syncCalendarEvent(calendar, item, config.DRY_RUN, item.firstSeenAt);
      calendarResults[result.action] = (calendarResults[result.action] ?? 0) + 1;
      if ('eventId' in result && item.calendarEventId !== result.eventId) {
        await repository.upsertDetectedItems([
          {
            ...item,
            status: sourceStatusById.get(item.id) ?? item.status,
            calendarEventId: result.eventId,
          },
        ]);
      }
    }
    logger.info(
      { module: 'Calendar', results: calendarResults },
      'Eventos acadêmicos sincronizados',
    );
    run.calendarStatus = 'SUCCESS';
  } catch (error) {
    run.calendarStatus = 'FAILED';
    run.errors.push(`Calendar: ${error instanceof Error ? error.message : 'erro'}`);
  }

  try {
    if (run.portalStatus === 'FAILED' || run.portalStatus === 'NOT_VERIFIED') {
      await telegram.sendMessage(
        '⚠️ Não consegui entrar no Portal UVV agora. Gmail e Calendar foram verificados normalmente.',
      );
    }
    const eadError = run.errors.find((error) => error.startsWith('Portal AVA/EAD:'));
    if (eadError) {
      await telegram.sendMessage(
        `⚠️ Não consegui abrir o AVA nesta verificação. ${escapeHtml(eadError.replace('Portal AVA/EAD: ', ''))}`,
      );
    }
    if (isBootstrap) {
      await telegram.sendMessage(
        `✅ <b>Tudo pronto!</b>\n\nFiz a primeira leitura e encontrei ${String(candidates.length)} registros. A partir de agora te aviso só do que importa. Use /painel quando quiser ver tudo.`,
      );
    }
  } catch (error) {
    run.errors.push(`Telegram envio: ${error instanceof Error ? error.message : 'erro'}`);
  }

  const agenda = buildAgenda(allItems, now);
  const plan = planNotifications({
    agenda,
    items: allItems,
    log: await repository.listNotificationLog(),
    // Na primeira leitura nada é novidade; o registro é criado em silêncio.
    newItemIds: new Set(isBootstrap ? [] : diff.newItems.map((item) => item.id)),
    now,
  });
  const context = createRenderContext({
    now,
    items: allItems,
    reminders: await repository.listReminders(),
  });
  run.errors.push(
    ...(await deliverNotifications({
      telegram,
      repository,
      slot,
      context,
      plan,
      weekly: isWeeklyReviewRun(now, slot),
    })),
  );
  logger.info(
    {
      module: 'Telegram',
      slot,
      notifications: plan.notifications.length,
      exams: agenda.exams.length,
      tasks: agenda.tasks.length,
      overdue: agenda.overdue.length,
    },
    'Notificações processadas',
  );

  run.finishedAt = new Date().toISOString();
  await repository.appendRunHistory(run);
  logger.info({ run }, 'Execução finalizada');

  // Os botões do Telegram leem uma cópia da planilha no Apps Script: renova com esta coleta.
  try {
    const webhook = await telegram.webhookUrl();
    if (webhook && (await refreshWebhookCache(webhook))) {
      logger.info({ module: 'Telegram' }, 'Cópia do bot no Apps Script atualizada');
    }
  } catch (error) {
    logger.warn(
      { module: 'Telegram', error: error instanceof Error ? error.message : 'erro' },
      'Não consegui atualizar a cópia do bot no Apps Script',
    );
  }
}
