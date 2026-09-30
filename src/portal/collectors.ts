import type { Page, Response } from 'playwright';
import { PORTAL_URLS } from './constants.js';
import type { ClassCardInput, MessageLinkInput, PortalItem } from './models.js';
import {
  parseCalendarResponse,
  parseClassCards,
  parseMessageLinks,
  parseWorkflowResponse,
} from './parsers.js';

async function navigate(page: Page, url: string): Promise<void> {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (response && response.status() >= 400) {
    throw new Error(`Portal respondeu com HTTP ${response.status()} em ${url}`);
  }
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

async function responseJson(response: Response): Promise<unknown> {
  return (await response.json()) as unknown;
}

export async function collectMessages(page: Page): Promise<PortalItem[]> {
  await navigate(page, PORTAL_URLS.messages);
  const inputs: MessageLinkInput[] = await page
    .locator('a[href*="/Aluno/Mensagens/?mId="]')
    .evaluateAll((links) =>
      links.map((link) => ({
        text: link.textContent ?? '',
        href: (link as HTMLAnchorElement).href,
      })),
    );
  return parseMessageLinks(inputs);
}

export async function collectClassPosts(page: Page): Promise<PortalItem[]> {
  await navigate(page, PORTAL_URLS.classes);
  const cards: ClassCardInput[] = await page.locator('.card-turma').evaluateAll((elements) =>
    elements.map((card) => ({
      heading:
        card.querySelector('.card-turma-head')?.textContent ??
        card.querySelector('h1,h2,h3,h4,strong')?.textContent ??
        '',
      text: card.textContent ?? '',
      links: Array.from(card.querySelectorAll('a[href*="/Aluno/Post/"]')).map((link) => ({
        text: link.textContent ?? '',
        href: (link as HTMLAnchorElement).href,
      })),
    })),
  );
  return parseClassCards(cards);
}

export async function collectServiceHistory(page: Page): Promise<PortalItem[]> {
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/Ajax/GetWorkflowHistory') && response.status() === 200,
  );
  await navigate(page, PORTAL_URLS.service);
  return parseWorkflowResponse(await responseJson(await responsePromise));
}

export async function collectCalendarEvents(page: Page): Promise<PortalItem[]> {
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/Calendario/ObterEventos') && response.status() === 200,
  );
  await navigate(page, PORTAL_URLS.calendar);
  return parseCalendarResponse(await responseJson(await responsePromise));
}

export async function collectRegularSchedule(page: Page): Promise<PortalItem[]> {
  await navigate(page, PORTAL_URLS.schedule);
  const panels = await page.locator('.panel').allTextContents();
  return panels
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text, index) => ({
      externalId: `schedule:panel:${index}`,
      origin: 'SCHEDULE' as const,
      sourceUrl: PORTAL_URLS.schedule,
      title: 'Quadro regular de horários',
      description: text,
      type: 'CLASS' as const,
      links: [],
      metadata: { contextOnly: 'true' },
    }));
}

export async function collectAllPortalItems(page: Page): Promise<PortalItem[]> {
  const results: PortalItem[] = [];
  for (const collector of [
    collectMessages,
    collectClassPosts,
    collectServiceHistory,
    collectCalendarEvents,
    collectRegularSchedule,
  ]) {
    results.push(...(await collector(page)));
  }
  return results;
}
