import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, requirePortalCredentials } from '../config/env.js';
import { ensurePortalAuthenticated } from '../portal/auth.js';
import { createPortalBrowserSession } from '../portal/browser.js';
import {
  collectCalendarEvents,
  collectClassPosts,
  collectMessages,
  collectRegularSchedule,
  collectServiceHistory,
} from '../portal/collectors.js';
import type { PortalItem } from '../portal/models.js';
import { logger } from '../utils/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const session = await createPortalBrowserSession();
  const collected: PortalItem[] = [];
  const errors: string[] = [];

  try {
    await ensurePortalAuthenticated(session.page, requirePortalCredentials(config), {
      timeoutMs: config.PORTAL_TIMEOUT_MS,
      diagnosticsDirectory: config.DIAGNOSTICS_DIR,
    });

    const collectors = [
      ['Mensagens', collectMessages],
      ['Turmas', collectClassPosts],
      ['Atendimento', collectServiceHistory],
      ['Calendário', collectCalendarEvents],
      ['Horários', collectRegularSchedule],
    ] as const;

    for (const [name, collector] of collectors) {
      try {
        const items = await collector(session.page);
        collected.push(...items);
        logger.info({ module: 'Portal', source: name, items: items.length }, 'Coleta concluída');
      } catch (error) {
        errors.push(`${name}: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
        logger.error({ module: 'Portal', source: name }, 'Fonte não pôde ser coletada');
      }
    }

    const outputDirectory = path.resolve(config.DIAGNOSTICS_DIR);
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, 'latest-portal-items.json');
    await writeFile(
      outputPath,
      JSON.stringify({ collectedAt: new Date().toISOString(), items: collected, errors }, null, 2),
      'utf8',
    );
    logger.info(
      { module: 'Portal', total: collected.length, errors: errors.length, artifact: outputPath },
      'Coleta do Portal finalizada',
    );
    if (errors.length === collectors.length) process.exitCode = 1;
  } finally {
    await session.close();
  }
}

main().catch((error: unknown) => {
  logger.error(
    { module: 'Portal' },
    error instanceof Error ? error.message : 'Falha fatal na coleta do Portal',
  );
  process.exitCode = 1;
});
