export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailRawMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GmailPart;
}

export interface ParsedGmailMessage {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  body: string;
  links: string[];
  attachments: Array<{ filename: string; mimeType: string; attachmentId?: string; size?: number }>;
}
