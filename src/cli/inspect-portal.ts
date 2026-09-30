import { loadConfig } from '../config/env.js';
import { classifyAuthPage } from '../portal/auth-signals.js';
import { inspectPortalEntry } from '../portal/auth.js';
import { createPortalBrowserSession } from '../portal/browser.js';
import { logger } from '../utils/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const session = await createPortalBrowserSession();

  try {
    const signals = await inspectPortalEntry(session.page, config.PORTAL_TIMEOUT_MS);
    const kind = classifyAuthPage(signals);
    logger.info(
      {
        module: 'Portal',
        kind,
        url: signals.url,
        usernameField: signals.hasUsernameField,
        passwordField: signals.hasPasswordField,
        submitButton: signals.hasSubmitButton,
      },
      'Entrada pública do Portal inspecionada',
    );

    if (kind !== 'LOGIN' && kind !== 'AUTHENTICATED') {
      throw new Error(`Estado inesperado da entrada do Portal: ${kind}`);
    }
  } finally {
    await session.close();
  }
}

main().catch((error: unknown) => {
  logger.error(
    { module: 'Portal' },
    error instanceof Error ? error.message : 'Falha ao inspecionar o Portal',
  );
  process.exitCode = 1;
});
