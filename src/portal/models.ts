import type { ItemType } from '../models/academic-item.js';

export type PortalItemOrigin =
  'MESSAGE' | 'CLASS_POST' | 'EAD' | 'SERVICE' | 'CALENDAR' | 'SCHEDULE';

export interface PortalItem {
  externalId: string;
  origin: PortalItemOrigin;
  sourceUrl: string;
  title: string;
  description: string;
  discipline?: string;
  professor?: string;
  type: ItemType;
  publishedAt?: string;
  officialDate?: string;
  officialDeadline?: string;
  status?: string;
  links: string[];
  metadata: Record<string, string>;
}

export interface MessageLinkInput {
  text: string;
  href: string;
}

export interface ClassCardInput {
  heading: string;
  text: string;
  links: Array<{ text: string; href: string }>;
}

export interface ClassPostPageInput {
  url: string;
  discipline: string;
  headings: string[];
  bodyText: string;
  pageText: string;
  links: Array<{ text: string; href: string }>;
  referenceYear: number;
}
