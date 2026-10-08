import { loadConfig, requireTelegramCredentials, type AppConfig } from '../config/env.js';
import { scheduledSlots, type DailySlot } from '../scheduler/windows.js';
import { runMonitor } from '../scheduler/orchestrator.js';
import { TelegramClient } from '../telegram/client.js';
import { reportWebhookFailure, type MonitorFailureCode } from '../telegram/webhook-cache.js';
import { logger } from '../utils/logger.js';

function resolveSlot(configured: DailySlot | undefined, now: Date): DailySlot {
  if (configured) return configured;
  const localHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      hour12: false,
    }).format(now),
  );
  return scheduledSlots.find((slot) => Number(slot.slice(0, 2)) >= localHour) ?? '23:00';
}

export function classifyMonitorFailure(error: unknown): MonitorFailureCode {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid_grant|token has been expired or revoked/i.test(message)
    ? 'GOOGLE_AUTH'
    : 'MONITOR_FAILED';
}

async function notifyMonitorFailure(config: AppConfig, error: unknown): Promise<void> {
  try {
    const credentials = requireTelegramCredentials(config);
    const telegram = new TelegramClient(credentials.botToken, credentials.chatId);
    const webhookUrl = await telegram.webhookUrl();
    if (webhookUrl) await reportWebhookFailure(webhookUrl, classifyMonitorFailure(error));
  } catch (notificationError) {
    logger.warn(
      {},
      `Não foi possível avisar a falha pelo webhook: ${notificationError instanceof Error ? notificationError.message : String(notificationError)}`,
    );
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  try {
    await runMonitor(config, resolveSlot(config.RUN_SLOT, new Date()));
  } catch (error) {
    logger.fatal({}, error instanceof Error ? error.message : 'Execução fatal');
    await notifyMonitorFailure(config, error);
    process.exitCode = 1;
  }
}

void main();
