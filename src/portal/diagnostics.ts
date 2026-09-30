import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';

function safeTimestamp(): string {
  return new Date().toISOString().replaceAll(':', '-');
}

export async function capturePortalDiagnostic(
  page: Page,
  outputDirectory: string,
  stage: string,
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  const prefix = path.join(outputDirectory, `${safeTimestamp()}-${stage}`);
  await page.screenshot({ path: `${prefix}.png`, fullPage: true }).catch(() => undefined);

  const metadata = {
    capturedAt: new Date().toISOString(),
    stage,
    url: page.url(),
    title: await page.title().catch(() => 'unavailable'),
  };
  await writeFile(`${prefix}.json`, JSON.stringify(metadata, null, 2), 'utf8');
}
