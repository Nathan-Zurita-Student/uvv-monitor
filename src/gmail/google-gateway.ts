import { google, type gmail_v1 } from 'googleapis';
import type { GoogleCredentials } from '../config/env.js';
import { createGoogleOAuthClient } from '../google/auth.js';
import type { GmailPart, GmailRawMessage } from './types.js';

function convertPart(part: gmail_v1.Schema$MessagePart): GmailPart {
  return {
    ...(part.mimeType ? { mimeType: part.mimeType } : {}),
    ...(part.filename ? { filename: part.filename } : {}),
    ...(part.headers
      ? {
          headers: part.headers.flatMap((item) =>
            item.name && item.value ? [{ name: item.name, value: item.value }] : [],
          ),
        }
      : {}),
    ...(part.body
      ? {
          body: {
            ...(part.body.data ? { data: part.body.data } : {}),
            ...(part.body.attachmentId ? { attachmentId: part.body.attachmentId } : {}),
            ...(part.body.size !== null && part.body.size !== undefined
              ? { size: part.body.size }
              : {}),
          },
        }
      : {}),
    ...(part.parts ? { parts: part.parts.map(convertPart) } : {}),
  };
}

export class GmailGoogleGateway {
  private readonly gmail;

  constructor(credentials: GoogleCredentials) {
    this.gmail = google.gmail({ version: 'v1', auth: createGoogleOAuthClient(credentials) });
  }

  async listRelevantCandidates(after: Date): Promise<string[]> {
    const query = `after:${String(Math.floor(after.getTime() / 1000))} {from:(@uvv.br) "prova" "avaliação" "trabalho" "AOP" "atividade" "estágio" "secretaria" "coordenação" "portal do aluno" "disciplina"}`;
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        ...(pageToken ? { pageToken } : {}),
      });
      ids.push(
        ...(response.data.messages ?? []).flatMap((message) => (message.id ? [message.id] : [])),
      );
      if (ids.length >= 200) return ids.slice(0, 200);
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
    return ids;
  }

  async getMessage(id: string): Promise<GmailRawMessage> {
    const response = await this.gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    if (!response.data.id || !response.data.threadId)
      throw new Error('Gmail retornou mensagem sem ID.');
    return {
      id: response.data.id,
      threadId: response.data.threadId,
      ...(response.data.internalDate ? { internalDate: response.data.internalDate } : {}),
      ...(response.data.payload ? { payload: convertPart(response.data.payload) } : {}),
    };
  }
}
