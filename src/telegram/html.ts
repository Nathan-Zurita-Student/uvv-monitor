/** Helpers para o modo `parse_mode: HTML` do Telegram. Todo texto dinâmico passa por escape. */

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

export function bold(value: string): string {
  return `<b>${escapeHtml(value)}</b>`;
}

export function italic(value: string): string {
  return `<i>${escapeHtml(value)}</i>`;
}

export function code(value: string): string {
  return `<code>${escapeHtml(value)}</code>`;
}

export function link(url: string, label: string): string {
  return /^https?:\/\//i.test(url)
    ? `<a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
}

export function truncate(value: string, maxLength: number): string {
  const cleaned = value
    .replace(/^[?�\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned;
}

/** Junta blocos em mensagens abaixo do limite do Telegram sem quebrar um bloco (e suas tags). */
export function packBlocks(
  header: string,
  blocks: string[],
  continuationHeader: string,
  limit = 3_800,
): string[] {
  const messages: string[] = [];
  let current = header;
  let hasBlocks = false;
  for (const block of blocks) {
    const candidate = `${current}\n\n${block}`;
    if (hasBlocks && candidate.length > limit) {
      messages.push(current);
      current = `${continuationHeader}\n\n${block}`;
    } else {
      current = candidate;
    }
    hasBlocks = true;
  }
  messages.push(current);
  return messages;
}
