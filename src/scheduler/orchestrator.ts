import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/env.js';
import {
  requireGoogleCredentials,
  requirePortalCredentials,
  requireTelegramCredentials,
} from '../config/env.js';
import { buildAgenda } from '../agenda/agenda.js';
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
import { verificationWindow, type DailySlot, isWeeklyReviewRun } from './windows.js';
import { TelegramClient } from '../telegram/client.js';
import { formatBootstrap } from '../telegram/format.js';
import { escapeHtml } from '../telegram/html.js';
import { deliverNotifications, type Novelty } from '../telegram/notifier.js';
import { processTelegramUpdates } from '../telegram/processor.js';
import { logger } from '../utils/logger.js';
import { collectMoodleCalendar } from '../moodle/calendar-feed.js';
import { createAiProvider, enrichItemsWithAi } from '../ai/service.js';
import type { AiProvider } from '../ai/types.js';

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
      await processTelegramUpdates(
        telegram,
        repository,
        telegramCredentials.chatId,
        now.toISOString(),
      );
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
  let prioritized = prioritizeItems(touched, now);
  const meaningfulChanges = diff.changedItems.filter(({ item, changes }) => {
    if (changes.length === 0) return false;
    const enrichmentOnly = changes.every(({ field }) =>
      ['description', 'discipline'].includes(field),
    );
    const previousDescription = changes.find(({ field }) => field === 'description')?.before;
    return !(enrichmentOnly && previousDescription === item.metadata?.originalTitle);
  });
  const noveltyIds = new Set(
    [...diff.newItems, ...meaningfulChanges.map(({ item }) => item)].map((item) => item.id),
  );

  let aiProvider: AiProvider | undefined;
  try {
    aiProvider = createAiProvider(config);
    const ai = await enrichItemsWithAi(prioritized, aiProvider, {
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
  await repository.upsertDetectedItems(prioritized);
  run.itemsFound = candidates.length;
  const allItems = prioritizeItems(await repository.listDetectedItems(), now);

  const calendar = new GoogleCalendarGateway(googleCredentials, config.GOOGLE_CALENDAR_ID);
  try {
    const calendarResults: Record<string, number> = {};
    for (const item of allItems.filter(isCalendarSyncCandidate)) {
      const result = await syncCalendarEvent(calendar, item, config.DRY_RUN, item.firstSeenAt);
      calendarResults[result.action] = (calendarResults[result.action] ?? 0) + 1;
      if ('eventId' in result && item.calendarEventId !== result.eventId) {
        await repository.upsertDetectedItems([{ ...item, calendarEventId: result.eventId }]);
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
        '⚠️ <b>Portal UVV não verificado nesta execução.</b>\nGmail e Calendar continuaram sendo verificados normalmente.',
      );
    }
    const eadError = run.errors.find((error) => error.startsWith('Portal AVA/EAD:'));
    if (eadError) {
      await telegram.sendMessage(
        `⚠️ <b>Ambiente Virtual (EAD) não verificado nesta execução.</b>\n\nO Portal UVV não conseguiu gerar o acesso automático aos cursos online. ${escapeHtml(eadError.replace('Portal AVA/EAD: ', ''))}\n\nAs páginas presenciais, o Gmail e o Calendar continuaram sendo verificados normalmente.`,
      );
    }
    if (isBootstrap) await telegram.sendMessage(formatBootstrap(candidates.length));
  } catch (error) {
    run.errors.push(`Telegram envio: ${error instanceof Error ? error.message : 'erro'}`);
  }

  const latestById = new Map(allItems.map((item) => [item.id, item]));
  const novelties: Novelty[] = isBootstrap
    ? []
    : [
        ...diff.newItems.map((item) => ({
          item: latestById.get(item.id) ?? item,
          isNew: true,
          changes: [],
        })),
        ...meaningfulChanges.map(({ item, changes }) => ({
          item: latestById.get(item.id) ?? item,
          isNew: false,
          changes,
        })),
      ];
  const agenda = buildAgenda(allItems, now);
  run.errors.push(
    ...(await deliverNotifications({
      telegram,
      repository,
      chatId: telegramCredentials.chatId,
      slot,
      agenda,
      novelties,
      weekly: isWeeklyReviewRun(now, slot),
      ...(config.TELEGRAM_ACTIONS_WEB_APP_URL
        ? { actionBaseUrl: config.TELEGRAM_ACTIONS_WEB_APP_URL }
        : {}),
      ...(aiProvider ? { aiProvider } : {}),
    })),
  );
  logger.info(
    {
      module: 'Telegram',
      slot,
      novelties: novelties.length,
      exams: agenda.exams.length,
      tasks: agenda.tasks.length,
      overdue: agenda.overdue.length,
    },
    'Notificações processadas',
  );

  run.finishedAt = new Date().toISOString();
  await repository.appendRunHistory(run);
  logger.info({ run }, 'Execução finalizada');
}
