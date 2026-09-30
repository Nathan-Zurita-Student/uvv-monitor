import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'playwright';
import { loadConfig, requirePortalCredentials } from '../config/env.js';
import { ensurePortalAuthenticated } from '../portal/auth.js';
import { createPortalBrowserSession } from '../portal/browser.js';
import { PORTAL_URLS } from '../portal/constants.js';
import { logger } from '../utils/logger.js';

interface NetworkEntry {
  method: string;
  resourceType: string;
  status: number;
  url: string;
  contentType: string;
}

interface PageStructure {
  name: string;
  requestedUrl: string;
  finalUrl: string;
  title: string;
  headings: string[];
  tableHeaders: string[][];
  linkSamples: Array<{ text: string; href: string }>;
  forms: Array<{ action: string; method: string; fields: string[] }>;
  structuralClasses: string[];
  relevantElements: Array<{
    tag: string;
    classes: string;
    href: string;
    text: string;
    parentTag: string;
    parentClasses: string;
  }>;
  network: NetworkEntry[];
  responsePayloads: Array<{ url: string; body: unknown }>;
}

function compactText(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function sanitizeNetworkUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  for (const parameter of ['connectionToken', 'userId', '_']) {
    if (url.searchParams.has(parameter)) url.searchParams.set(parameter, '[REDACTED]');
  }
  return url.toString();
}

async function main(): Promise<void> {
  const config = loadConfig();
  const credentials = requirePortalCredentials(config);
  const session = await createPortalBrowserSession();
  const outputDirectory = path.resolve(config.DIAGNOSTICS_DIR, 'authenticated-structure');
  await mkdir(outputDirectory, { recursive: true });

  try {
    await ensurePortalAuthenticated(session.page, credentials, {
      timeoutMs: config.PORTAL_TIMEOUT_MS,
      diagnosticsDirectory: config.DIAGNOSTICS_DIR,
    });

    const targets = [
      ['messages', PORTAL_URLS.messages],
      ['classes', PORTAL_URLS.classes],
      ['schedule', PORTAL_URLS.schedule],
      ['service', PORTAL_URLS.service],
      ['calendar', PORTAL_URLS.calendar],
    ] as const;

    for (const [name, requestedUrl] of targets) {
      const network: NetworkEntry[] = [];
      const responsePayloads: Array<{ url: string; body: unknown }> = [];
      const responseTasks: Array<Promise<void>> = [];
      const listener = (response: Response) => {
        const request = response.request();
        if (!['xhr', 'fetch', 'document'].includes(request.resourceType())) return;
        network.push({
          method: request.method(),
          resourceType: request.resourceType(),
          status: response.status(),
          url: sanitizeNetworkUrl(response.url()),
          contentType: response.headers()['content-type'] ?? '',
        });
        if (
          response.headers()['content-type']?.includes('application/json') &&
          !response.url().includes('/signalr/')
        ) {
          responseTasks.push(
            response
              .json()
              .then((body: unknown) => {
                responsePayloads.push({ url: sanitizeNetworkUrl(response.url()), body });
              })
              .catch(() => undefined),
          );
        }
      };
      session.page.on('response', listener);
      const response = await session.page.goto(requestedUrl, { waitUntil: 'domcontentloaded' });
      await session.page.waitForLoadState('networkidle').catch(() => undefined);
      session.page.off('response', listener);
      await Promise.all(responseTasks);

      if (response && response.status() >= 400) {
        throw new Error(`${name} respondeu com HTTP ${response.status()}`);
      }

      const structure: PageStructure = {
        name,
        requestedUrl,
        finalUrl: session.page.url(),
        title: await session.page.title(),
        headings: await session.page
          .locator('h1,h2,h3,h4,.page-title,.panel-title')
          .allTextContents(),
        tableHeaders: await session.page
          .locator('table')
          .evaluateAll((tables) =>
            tables.map((table) =>
              Array.from(table.querySelectorAll('thead th')).map((cell) =>
                (cell.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
              ),
            ),
          ),
        linkSamples: (
          await session.page.locator('a[href]').evaluateAll((links) =>
            links.slice(0, 100).map((link) => ({
              text: (link.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
              href: (link as HTMLAnchorElement).href,
            })),
          )
        ).filter((link) => link.text || link.href.includes('/Aluno/')),
        forms: await session.page.locator('form').evaluateAll((forms) =>
          forms.map((form) => ({
            action: (form as HTMLFormElement).action,
            method: (form as HTMLFormElement).method,
            fields: Array.from(form.querySelectorAll('input,select,textarea')).map(
              (field) => field.getAttribute('name') ?? field.id ?? field.tagName.toLowerCase(),
            ),
          })),
        ),
        structuralClasses: await session.page
          .locator('[class]')
          .evaluateAll((elements) =>
            Array.from(
              new Set(
                elements
                  .flatMap((element) => Array.from(element.classList))
                  .filter((className) =>
                    /message|mensagem|turma|disciplina|calendar|event|atendimento|solicita|table|card|panel/i.test(
                      className,
                    ),
                  ),
              ),
            ).sort(),
          ),
        relevantElements: await session.page
          .locator(
            'a[href*="/Aluno/Mensagens/?mId="],a[href*="/Aluno/Post/"],.card-turma,a[href="#leitura"],.fc-event,.panel',
          )
          .evaluateAll((elements) =>
            elements.slice(0, 100).map((element) => ({
              tag: element.tagName.toLowerCase(),
              classes: element.getAttribute('class') ?? '',
              href: element instanceof HTMLAnchorElement ? element.href : '',
              text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
              parentTag: element.parentElement?.tagName.toLowerCase() ?? '',
              parentClasses: element.parentElement?.getAttribute('class') ?? '',
            })),
          ),
        network,
        responsePayloads,
      };

      structure.headings = structure.headings.map(compactText).filter(Boolean);
      const outputPath = path.join(outputDirectory, `${name}.json`);
      await writeFile(outputPath, JSON.stringify(structure, null, 2), 'utf8');
      logger.info(
        {
          module: 'Portal',
          page: name,
          finalUrl: structure.finalUrl,
          tables: structure.tableHeaders.length,
          links: structure.linkSamples.length,
          networkRequests: network.length,
          artifact: outputPath,
        },
        'Estrutura autenticada coletada',
      );
    }
  } finally {
    await session.close();
  }
}

main().catch((error: unknown) => {
  logger.error(
    { module: 'Portal' },
    error instanceof Error ? error.message : 'Falha na inspeção autenticada',
  );
  process.exitCode = 1;
});
