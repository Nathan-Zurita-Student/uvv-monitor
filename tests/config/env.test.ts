import { describe, expect, it } from 'vitest';
import { configPresence, loadConfig, requirePortalCredentials } from '../../src/config/env.js';

describe('configuração de ambiente', () => {
  it('usa DRY_RUN e timezone seguro por padrão', () => {
    const config = loadConfig({});
    expect(config.DRY_RUN).toBe(true);
    expect(config.TZ).toBe('America/Sao_Paulo');
    expect(config.TELEGRAM_WEBHOOK_ENABLED).toBe(false);
    expect(config.AI_ENABLED).toBe(false);
    expect(config.AI_PROVIDER).toBe('gemini');
  });

  it('aceita integrações opcionais vazias do arquivo de exemplo', () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      GOOGLE_REFRESH_TOKEN: '',
      GOOGLE_SHEET_ID: '',
      MOODLE_CALENDAR_URL: '',
    });
    expect(configPresence(config)).toEqual(
      expect.objectContaining({
        telegram: false,
        googleOAuth: false,
        googleSheet: false,
        moodleCalendar: false,
        aiEnabled: false,
      }),
    );
  });

  it('não inclui os valores de secrets no resumo', () => {
    const config = loadConfig({
      UVV_USERNAME: '123456',
      UVV_PASSWORD: 'segredo',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_CHAT_ID: 'chat',
    });
    expect(configPresence(config)).toEqual(
      expect.objectContaining({ uvvCredentials: true, telegram: true }),
    );
    expect(JSON.stringify(configPresence(config))).not.toContain('segredo');
    expect(JSON.stringify(configPresence(config))).not.toContain('token');
  });

  it('exige as duas credenciais do portal', () => {
    expect(() => requirePortalCredentials(loadConfig({ UVV_USERNAME: '123' }))).toThrow(
      /UVV_USERNAME e UVV_PASSWORD/,
    );
  });

  it('aceita somente um dos nove horários atuais', () => {
    expect(loadConfig({ RUN_SLOT: '23:00' }).RUN_SLOT).toBe('23:00');
    expect(() => loadConfig({ RUN_SLOT: '17:00' })).toThrow(/RUN_SLOT/);
  });
});
