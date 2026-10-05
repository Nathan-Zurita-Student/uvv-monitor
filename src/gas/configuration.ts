/** Sincroniza somente as credenciais necessárias, pelo webhook autenticado já existente. */
export function configureConversation(value: unknown): string {
  if (!value || typeof value !== 'object') throw new Error('Configuração inválida.');
  const values = value as Record<string, unknown>;
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
  if (required.some((key) => typeof values[key] !== 'string' || !values[key]))
    throw new Error('Credenciais Google ausentes.');
  const properties = PropertiesService.getScriptProperties();
  for (const key of [...required, 'OPENAI_API_KEY', 'GOOGLE_CALENDAR_ID']) {
    const setting = values[key];
    if (typeof setting === 'string' && setting.trim() && setting.length < 5000)
      properties.setProperty(key, setting.trim());
  }
  CacheService.getScriptCache().remove('conversation.calendar-token');
  return JSON.stringify({
    configured: true,
    openaiKeyConfigured: Boolean(properties.getProperty('OPENAI_API_KEY')),
  });
}

/** Usa a autorização Calendar que o monitor já recebeu, sem pedir novos escopos no Apps Script. */
export function conversationCalendarToken(): string {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('conversation.calendar-token');
  if (cached) return cached;
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('GOOGLE_CLIENT_ID');
  const clientSecret = props.getProperty('GOOGLE_CLIENT_SECRET');
  const refreshToken = props.getProperty('GOOGLE_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken)
    throw new Error(
      'A agenda precisa da configuração Google do monitor. Execute a ação “Configurar conversa do Telegram” no GitHub.',
    );
  const body = {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  };
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: Object.entries(body)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&'),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200)
    throw new Error(
      'A autorização Google da agenda expirou ou foi recusada. Nenhum compromisso foi confirmado.',
    );
  const token = JSON.parse(response.getContentText()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in! < 120)
    throw new Error('Não consegui autorizar a agenda agora.');
  cache.put(
    'conversation.calendar-token',
    token.access_token,
    Math.min(3300, token.expires_in! - 60),
  );
  return token.access_token;
}
