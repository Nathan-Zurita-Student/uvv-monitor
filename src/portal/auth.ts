import type { Locator, Page, Response } from 'playwright';
import type { PortalCredentials } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  classifyAuthPage,
  containsSecurityChallenge,
  type AuthPageSignals,
} from './auth-signals.js';
import { PORTAL_HOSTNAME, PORTAL_URLS } from './constants.js';
import { capturePortalDiagnostic } from './diagnostics.js';
import { PortalError } from './errors.js';

export interface PortalAuthOptions {
  timeoutMs: number;
  diagnosticsDirectory: string;
}

export interface PortalAuthResult {
  status: 'AUTHENTICATED';
  loginPerformed: boolean;
  url: string;
}

async function firstVisible(candidates: Locator[]): Promise<Locator | undefined> {
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.first().isVisible())) {
      return candidate.first();
    }
  }
  return undefined;
}

export async function readAuthSignals(page: Page): Promise<AuthPageSignals> {
  const username = await firstVisible([
    page.getByLabel(/matr[ií]cula/i),
    page.locator('input[name="Matricula"]'),
  ]);
  const password = await firstVisible([
    page.getByLabel(/senha/i),
    page.locator('input[name="Password"]'),
    page.locator('input[type="password"]'),
  ]);
  const submit = await firstVisible([
    page.getByRole('button', { name: /entrar/i }),
    page.locator('button[type="submit"]'),
  ]);
  const authenticatedNavigation = page.locator(
    'a[href*="/Aluno/Mensagens"], a[href*="/Aluno/MinhasTurmas"], a[href*="/Atendimento"]',
  );

  return {
    url: page.url(),
    hasUsernameField: Boolean(username),
    hasPasswordField: Boolean(password),
    hasSubmitButton: Boolean(submit),
    hasAuthenticatedNavigation: (await authenticatedNavigation.count()) > 0,
    visibleText: (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    ).slice(0, 20_000),
  };
}

export async function inspectPortalEntry(page: Page, timeoutMs: number): Promise<AuthPageSignals> {
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
  const response = await page.goto(PORTAL_URLS.base, { waitUntil: 'domcontentloaded' });
  validateInitialResponse(response);
  assertSafePortalUrl(page);
  return readAuthSignals(page);
}

function assertSafePortalUrl(page: Page): void {
  const url = new URL(page.url());
  if (url.hostname.toLowerCase() !== PORTAL_HOSTNAME) {
    throw new PortalError('UNEXPECTED', `Redirecionamento inesperado para ${url.hostname}.`);
  }
}

function validateInitialResponse(response: Response | null): void {
  if (response && response.status() >= 400) {
    throw new PortalError('HTTP_ERROR', `Portal respondeu com HTTP ${response.status()}.`);
  }
}

export async function ensurePortalAuthenticated(
  page: Page,
  credentials: PortalCredentials,
  options: PortalAuthOptions,
): Promise<PortalAuthResult> {
  page.setDefaultTimeout(options.timeoutMs);
  page.setDefaultNavigationTimeout(options.timeoutMs);

  try {
    const response = await page.goto(PORTAL_URLS.base, { waitUntil: 'domcontentloaded' });
    validateInitialResponse(response);
    assertSafePortalUrl(page);

    const initialSignals = await readAuthSignals(page);
    const initialKind = classifyAuthPage(initialSignals);

    if (initialKind === 'AUTHENTICATED') {
      logger.info({ module: 'Portal' }, 'Sessão já autenticada');
      return { status: 'AUTHENTICATED', loginPerformed: false, url: page.url() };
    }
    if (initialKind === 'CAPTCHA_OR_MFA') {
      throw new PortalError('CAPTCHA_OR_MFA', 'CAPTCHA ou MFA detectado antes do login.');
    }
    if (initialKind !== 'LOGIN') {
      throw new PortalError('LOGIN_FORM_CHANGED', 'Formulário de login não reconhecido.');
    }

    logger.info({ module: 'Portal' }, 'Login necessário');
    const username = await firstVisible([
      page.getByLabel(/matr[ií]cula/i),
      page.locator('input[name="Matricula"]'),
    ]);
    const password = await firstVisible([
      page.getByLabel(/senha/i),
      page.locator('input[name="Password"]'),
      page.locator('input[type="password"]'),
    ]);
    const submit = await firstVisible([
      page.getByRole('button', { name: /entrar/i }),
      page.locator('button[type="submit"]'),
    ]);

    if (!username || !password || !submit) {
      throw new PortalError('LOGIN_FORM_CHANGED', 'Campos obrigatórios do login não encontrados.');
    }

    await username.fill(credentials.username);
    await password.fill(credentials.password);
    await submit.click();
    await page.waitForLoadState('domcontentloaded');
    assertSafePortalUrl(page);

    const resultSignals = await readAuthSignals(page);
    if (containsSecurityChallenge(resultSignals.visibleText)) {
      throw new PortalError('CAPTCHA_OR_MFA', 'CAPTCHA ou MFA detectado após o envio do login.');
    }

    const resultKind = classifyAuthPage(resultSignals);
    if (resultKind === 'LOGIN') {
      throw new PortalError('LOGIN_REJECTED', 'Login não aceito pelo Portal UVV.');
    }
    if (resultKind !== 'AUTHENTICATED') {
      throw new PortalError(
        'LOGIN_FORM_CHANGED',
        'Não foi possível confirmar o estado autenticado.',
      );
    }

    logger.info({ module: 'Portal' }, 'Login realizado e confirmado');
    return { status: 'AUTHENTICATED', loginPerformed: true, url: page.url() };
  } catch (error) {
    await capturePortalDiagnostic(page, options.diagnosticsDirectory, 'login-failure');
    if (error instanceof PortalError) throw error;
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new PortalError('TIMEOUT', 'Tempo limite excedido no login do Portal.', {
        cause: error,
      });
    }
    throw new PortalError('UNEXPECTED', 'Falha inesperada no login do Portal.', {
      cause: error instanceof Error ? error : undefined,
    });
  }
}
