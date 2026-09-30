import { configPresence, loadConfig, requirePortalCredentials } from '../config/env.js';
import { ensurePortalAuthenticated } from '../portal/auth.js';
import { createPortalBrowserSession } from '../portal/browser.js';
import { PortalError } from '../portal/errors.js';
import { logger } from '../utils/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ config: configPresence(config) }, 'Configuração carregada');

  let credentials;
  try {
    credentials = requirePortalCredentials(config);
  } catch (error) {
    throw new PortalError(
      'CREDENTIALS_MISSING',
      error instanceof Error ? error.message : 'Credenciais do Portal ausentes.',
    );
  }

  const session = await createPortalBrowserSession();
  try {
    const result = await ensurePortalAuthenticated(session.page, credentials, {
      timeoutMs: config.PORTAL_TIMEOUT_MS,
      diagnosticsDirectory: config.DIAGNOSTICS_DIR,
    });
    logger.info(
      { module: 'Portal', loginPerformed: result.loginPerformed, url: result.url },
      'Portal verificado com sucesso',
    );
  } finally {
    await session.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof PortalError) {
    logger.error({ module: 'Portal', code: error.code }, error.message);
  } else {
    logger.error({ module: 'Portal' }, 'Falha não classificada');
  }
  process.exitCode = 1;
});
