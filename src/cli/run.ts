import { loadConfig } from '../config/env.js';
import type { DailySlot } from '../scheduler/windows.js';
import { runMonitor } from '../scheduler/orchestrator.js';
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
  if (localHour < 15) return '12:00';
  if (localHour < 19) return '17:00';
  return '21:00';
}

const config = loadConfig();
runMonitor(config, resolveSlot(config.RUN_SLOT, new Date())).catch((error: unknown) => {
  logger.fatal({}, error instanceof Error ? error.message : 'Execução fatal');
  process.exitCode = 1;
});
