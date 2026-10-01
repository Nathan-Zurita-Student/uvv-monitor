import 'dotenv/config';
import { z } from 'zod';

const optionalSecret = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.literal('America/Sao_Paulo').default('America/Sao_Paulo'),
  DRY_RUN: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORTAL_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
  DIAGNOSTICS_DIR: z.string().trim().min(1).default('artifacts/diagnostics'),
  RUN_SLOT: z.enum(['12:00', '17:00', '21:00']).optional(),
  UVV_USERNAME: optionalSecret,
  UVV_PASSWORD: optionalSecret,
  TELEGRAM_BOT_TOKEN: optionalSecret,
  TELEGRAM_CHAT_ID: optionalSecret,
  TELEGRAM_WEBHOOK_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  TELEGRAM_ACTIONS_WEB_APP_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: optionalSecret,
  GOOGLE_CLIENT_SECRET: optionalSecret,
  GOOGLE_REFRESH_TOKEN: optionalSecret,
  GOOGLE_SHEET_ID: optionalSecret,
  GOOGLE_CALENDAR_ID: z.string().trim().min(1).default('primary'),
  MOODLE_CALENDAR_URL: optionalUrl,
});

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuração inválida nos campos: ${fields}`);
  }
  return result.data;
}

export interface PortalCredentials {
  username: string;
  password: string;
}

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  sheetId: string;
}

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

export interface GoogleClientCredentials {
  clientId: string;
  clientSecret: string;
}

export function requirePortalCredentials(config: AppConfig): PortalCredentials {
  if (!config.UVV_USERNAME || !config.UVV_PASSWORD) {
    throw new Error(
      'Credenciais do Portal ausentes. Defina UVV_USERNAME e UVV_PASSWORD no ambiente.',
    );
  }
  return { username: config.UVV_USERNAME, password: config.UVV_PASSWORD };
}

export function requireGoogleCredentials(config: AppConfig): GoogleCredentials {
  if (
    !config.GOOGLE_CLIENT_ID ||
    !config.GOOGLE_CLIENT_SECRET ||
    !config.GOOGLE_REFRESH_TOKEN ||
    !config.GOOGLE_SHEET_ID
  ) {
    throw new Error(
      'Configuração Google ausente. Defina GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN e GOOGLE_SHEET_ID.',
    );
  }
  return {
    clientId: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    refreshToken: config.GOOGLE_REFRESH_TOKEN,
    sheetId: config.GOOGLE_SHEET_ID,
  };
}

export function requireGoogleClientCredentials(config: AppConfig): GoogleClientCredentials {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new Error('Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET antes da autorização OAuth.');
  }
  return { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET };
}

export function requireTelegramCredentials(config: AppConfig): TelegramCredentials {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
    throw new Error('Configuração Telegram ausente. Defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID.');
  }
  return { botToken: config.TELEGRAM_BOT_TOKEN, chatId: config.TELEGRAM_CHAT_ID };
}

export function configPresence(config: AppConfig): Record<string, boolean | string> {
  return {
    timezone: config.TZ,
    dryRun: config.DRY_RUN,
    uvvCredentials: Boolean(config.UVV_USERNAME && config.UVV_PASSWORD),
    telegram: Boolean(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID),
    telegramWebhook: config.TELEGRAM_WEBHOOK_ENABLED,
    telegramActionsWebApp: Boolean(config.TELEGRAM_ACTIONS_WEB_APP_URL),
    googleOAuth: Boolean(
      config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REFRESH_TOKEN,
    ),
    googleSheet: Boolean(config.GOOGLE_SHEET_ID),
    moodleCalendar: Boolean(config.MOODLE_CALENDAR_URL),
  };
}
