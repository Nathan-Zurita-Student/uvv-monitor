import type { DetectedItemCandidate } from '../persistence/deduplication.js';
import { inferItemType } from '../portal/parsers.js';
import type { GmailGoogleGateway } from './google-gateway.js';
import { parseGmailMessage } from './parser.js';
import { classifyGmailRelevance } from './relevance.js';

export async function collectRelevantGmail(
  gateway: Pick<GmailGoogleGateway, 'listRelevantCandidates' | 'getMessage'>,
  after: Date,
): Promise<DetectedItemCandidate[]> {
  const ids = await gateway.listRelevantCandidates(after);
  const candidates: DetectedItemCandidate[] = [];
  for (const id of ids) {
    const message = parseGmailMessage(await gateway.getMessage(id));
    const relevance = classifyGmailRelevance(message);
    if (!relevance.relevant) continue;
    const combined = `${message.subject}\n${message.body}`;
    candidates.push({
      externalId: `gmail:${message.messageId}`,
      source: 'GMAIL',
      sourceUrl: `https://mail.google.com/mail/u/0/#all/${message.threadId}`,
      title: message.subject || '(sem assunto)',
      description: message.body.slice(0, 10_000),
      type: inferItemType(combined),
      status: 'TODO',
      metadata: {
        threadId: message.threadId,
        from: message.from,
        receivedAt: message.date,
        links: JSON.stringify(message.links),
        attachments: JSON.stringify(message.attachments),
        relevanceReasons: relevance.reasons.join(','),
      },
    });
  }
  return candidates;
}
