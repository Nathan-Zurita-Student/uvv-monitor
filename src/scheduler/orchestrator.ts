import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/env.js';
import {
  requireGoogleCredentials,
  requirePortalCredentials,
  requireTelegramCredentials,
} from '../config/env.js';
import { GoogleCalendarGateway } from '../calendar/google-gateway.js';
import { syncCalendarEvent } from '../calendar/service.js';
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
import {
  format72HourSummary,
  formatNovelty,
  formatPriorityTask,
  formatPriorityTaskHeader,
  formatWeeklyReview,
} from '../telegram/format.js';
import { processTelegramUpdates } from '../telegram/processor.js';
import { buildTaskInlineKeyboard, isTrackableTask } from '../telegram/task-actions.js';
import { logger } from '../utils/logger.js';

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

  const window = verificationWindow(now, slot);
  try {
    candidates.push(
      ...(await collectRelevantGmail(new GmailGoogleGateway(googleCredentials), window.from)),
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
  const prioritized = prioritizeItems(touched, now);
  const prioritizedById = new Map(prioritized.map((item) => [item.id, item]));
  const meaningfulChangedItems = diff.changedItems
    .filter(({ item, changes }) => {
      if (changes.length === 0) return false;
      const enrichmentOnly = changes.every(({ field }) =>
        ['description', 'discipline'].includes(field),
      );
      const previousDescription = changes.find(({ field }) => field === 'description')?.before;
      return !(enrichmentOnly && previousDescription === item.metadata?.originalTitle);
    })
    .map(({ item }) => item);
  const changedNow = [...diff.newItems, ...meaningfulChangedItems].flatMap((item) => {
    const prioritizedItem = prioritizedById.get(item.id);
    return prioritizedItem ? [prioritizedItem] : [];
  });
  await repository.upsertDetectedItems(prioritized);
  run.itemsFound = candidates.length;

  const calendar = new GoogleCalendarGateway(googleCredentials, config.GOOGLE_CALENDAR_ID);
  try {
    for (const item of changedNow) {
      if (['OVERDUE', 'INFORMATIONAL'].includes(item.urgency)) continue;
      const result = await syncCalendarEvent(calendar, item, config.DRY_RUN, now.toISOString());
      if ('eventId' in result && item.calendarEventId !== result.eventId) {
        await repository.upsertDetectedItems([{ ...item, calendarEventId: result.eventId }]);
      }
    }
    run.calendarStatus = 'SUCCESS';
  } catch (error) {
    run.calendarStatus = 'FAILED';
    run.errors.push(`Calendar: ${error instanceof Error ? error.message : 'erro'}`);
  }

  try {
    if (run.portalStatus === 'FAILED' || run.portalStatus === 'NOT_VERIFIED') {
      await telegram.sendMessage('Portal/AVA não verificado nesta execução.');
    }
    const eadError = run.errors.find((error) => error.startsWith('Portal AVA/EAD:'));
    if (eadError) {
      await telegram.sendMessage(
        `⚠️ Ambiente Virtual (EAD) não verificado nesta execução.\n\nO Portal UVV não conseguiu gerar o acesso automático aos cursos online. ${eadError.replace('Portal AVA/EAD: ', '')}\n\nAs páginas presenciais, o Gmail e o Calendar continuaram sendo verificados normalmente.`,
      );
    }
    if (isBootstrap) {
      await telegram.sendMessage(
        `Tudo pronto! Fiz a primeira leitura do Portal, Gmail e Calendar.\n\nEncontrei ${String(candidates.length)} registros acadêmicos. Guardei os comunicados antigos no histórico, mas não vou tratá-los como novidades nem encher seu Telegram com alertas retroativos. A seguir, mostrarei somente o que realmente merece sua atenção.`,
      );
    } else {
      for (const item of changedNow) {
        if (item.metadata?.contextOnly !== 'true' && !isTrackableTask(item)) {
          await telegram.sendMessage(formatNovelty(item));
        }
      }
    }
    const allItems = prioritizeItems(await repository.listDetectedItems(), now);
    const allTasks = allItems.filter(isTrackableTask);
    const visibleTasks = allTasks.slice(0, 3);
    if (visibleTasks.length > 0) {
      await telegram.sendMessage(formatPriorityTaskHeader(visibleTasks.length, allTasks.length));
    }
    for (const item of visibleTasks) {
      const actionToken = randomUUID();
      const message = await telegram.sendMessage(
        formatPriorityTask(item),
        config.TELEGRAM_ACTIONS_WEB_APP_URL
          ? {
              inlineKeyboard: buildTaskInlineKeyboard(item, {
                actionBaseUrl: config.TELEGRAM_ACTIONS_WEB_APP_URL,
                actionToken,
              }),
            }
          : {},
      );
      await repository.upsertTelegramTaskMessage({
        itemId: item.id,
        chatId: telegramCredentials.chatId,
        messageId: message.message_id,
        lastRenderedStatus: item.status,
        updatedAt: now.toISOString(),
        actionToken,
      });
    }
    if (slot === '21:00') {
      const summary = format72HourSummary(allItems);
      if (summary) await telegram.sendMessage(summary);
      if (isWeeklyReviewRun(now, slot)) await telegram.sendMessage(formatWeeklyReview(allItems));
      logger.info(
        { module: 'Scheduler', weekly: isWeeklyReviewRun(now, slot) },
        'Resumo das 21h processado',
      );
    }
  } catch (error) {
    run.errors.push(`Telegram envio: ${error instanceof Error ? error.message : 'erro'}`);
  }

  run.finishedAt = new Date().toISOString();
  await repository.appendRunHistory(run);
  logger.info({ run }, 'Execução finalizada');
}
