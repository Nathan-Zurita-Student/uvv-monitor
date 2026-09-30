import pino from 'pino';

const secretKeys = [
  'password',
  'Password',
  'UVV_PASSWORD',
  'TELEGRAM_BOT_TOKEN',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'authorization',
  'cookie',
  'set-cookie',
];

export function createLogger(level = process.env.LOG_LEVEL ?? 'info') {
  return pino({
    level,
    redact: {
      paths: secretKeys.flatMap((key) => [
        key,
        `*.${key}`,
        `req.headers.${key}`,
        `res.headers.${key}`,
      ]),
      censor: '[REDACTED]',
    },
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const logger = createLogger();
