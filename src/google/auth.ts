import { google } from 'googleapis';
import type { GoogleCredentials } from '../config/env.js';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
] as const;

export function createGoogleOAuthClient(credentials: GoogleCredentials) {
  const client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  client.setCredentials({ refresh_token: credentials.refreshToken });
  return client;
}
