import { forgetGoogleToken } from './google-api.js';
import { DISPATCH_TOKEN_PROPERTY } from './collector-dispatch.js';

/** Sincroniza somente as credenciais necessárias, pelo webhook autenticado já existente. */
export function configureConversation(value: unknown): string {
  if (!value || typeof value !== 'object') throw new Error('Configuração inválida.');
  const values = value as Record<string, unknown>;
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
  if (required.some((key) => typeof values[key] !== 'string' || !values[key]))
    throw new Error('Credenciais Google ausentes.');
  const properties = PropertiesService.getScriptProperties();
  for (const key of [
    ...required,
    'OPENAI_API_KEY',
    'GOOGLE_CALENDAR_ID',
    DISPATCH_TOKEN_PROPERTY,
  ]) {
    const setting = values[key];
    if (typeof setting === 'string' && setting.trim() && setting.length < 5000)
      properties.setProperty(key, setting.trim());
  }
  forgetGoogleToken();
  return JSON.stringify({
    configured: true,
    openaiKeyConfigured: Boolean(properties.getProperty('OPENAI_API_KEY')),
    dispatchConfigured: Boolean(properties.getProperty(DISPATCH_TOKEN_PROPERTY)),
  });
}
