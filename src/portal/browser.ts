import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export interface PortalBrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export async function createPortalBrowserSession(): Promise<PortalBrowserSession> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    acceptDownloads: false,
  });
  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
