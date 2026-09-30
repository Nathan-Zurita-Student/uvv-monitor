import 'dotenv/config';

const required = [
  'UVV_USERNAME',
  'UVV_PASSWORD',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_SHEET_ID',
] as const;

let missing = false;
for (const name of required) {
  const present = Boolean(process.env[name]?.trim());
  console.log(`${name}: ${present ? 'OK' : 'MISSING'}`);
  if (!present) missing = true;
}

console.log(`DRY_RUN: ${process.env.DRY_RUN ?? 'true'}`);
console.log(`TZ: ${process.env.TZ ?? 'America/Sao_Paulo'}`);

if (process.env.DRY_RUN !== 'true') {
  console.error('DRY_RUN deve permanecer true durante a validação das integrações.');
  process.exitCode = 1;
} else if (missing) {
  process.exitCode = 1;
}
