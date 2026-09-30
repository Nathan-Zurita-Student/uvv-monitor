import { describe, expect, it } from 'vitest';
import { classifyAuthPage, containsSecurityChallenge } from '../../src/portal/auth-signals.js';

describe('classificação da tela de autenticação', () => {
  it('reconhece o formulário real observado no portal', () => {
    expect(
      classifyAuthPage({
        url: 'https://aluno.uvv.br/',
        hasUsernameField: true,
        hasPasswordField: true,
        hasSubmitButton: true,
        hasAuthenticatedNavigation: false,
        visibleText: 'Matrícula Senha Entrar',
      }),
    ).toBe('LOGIN');
  });

  it.each(['reCAPTCHA', 'Código de verificação', 'Autenticação em dois fatores', 'MFA'])(
    'detecta desafio de segurança: %s',
    (text) => expect(containsSecurityChallenge(text)).toBe(true),
  );

  it('prefere marcar desafio mesmo quando campos de login existem', () => {
    expect(
      classifyAuthPage({
        url: 'https://aluno.uvv.br/',
        hasUsernameField: true,
        hasPasswordField: true,
        hasSubmitButton: true,
        hasAuthenticatedNavigation: false,
        visibleText: 'Resolva o CAPTCHA',
      }),
    ).toBe('CAPTCHA_OR_MFA');
  });

  it('confirma sessão por navegação autenticada', () => {
    expect(
      classifyAuthPage({
        url: 'https://aluno.uvv.br/Aluno/Inicio',
        hasUsernameField: false,
        hasPasswordField: false,
        hasSubmitButton: false,
        hasAuthenticatedNavigation: true,
        visibleText: 'Minhas Turmas Mensagens',
      }),
    ).toBe('AUTHENTICATED');
  });

  it('não afirma autenticação sem evidência suficiente', () => {
    expect(
      classifyAuthPage({
        url: 'https://aluno.uvv.br/erro',
        hasUsernameField: false,
        hasPasswordField: false,
        hasSubmitButton: false,
        hasAuthenticatedNavigation: false,
        visibleText: 'Serviço indisponível',
      }),
    ).toBe('UNKNOWN');
  });
});
