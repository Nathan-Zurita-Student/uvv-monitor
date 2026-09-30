export interface AuthPageSignals {
  url: string;
  hasUsernameField: boolean;
  hasPasswordField: boolean;
  hasSubmitButton: boolean;
  hasAuthenticatedNavigation: boolean;
  visibleText: string;
}

export type AuthPageKind = 'LOGIN' | 'AUTHENTICATED' | 'CAPTCHA_OR_MFA' | 'UNKNOWN';

const challengePatterns = [
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /verifica(?:ç|c)ão em duas etapas/i,
  /autentica(?:ç|c)ão em dois fatores/i,
  /código de verifica(?:ç|c)ão/i,
  /one[- ]time password/i,
  /\bmfa\b/i,
];

export function containsSecurityChallenge(text: string): boolean {
  return challengePatterns.some((pattern) => pattern.test(text));
}

export function classifyAuthPage(signals: AuthPageSignals): AuthPageKind {
  if (containsSecurityChallenge(signals.visibleText)) return 'CAPTCHA_OR_MFA';

  if (signals.hasUsernameField && signals.hasPasswordField && signals.hasSubmitButton) {
    return 'LOGIN';
  }

  const url = new URL(signals.url);
  if (
    url.hostname.toLowerCase() === 'aluno.uvv.br' &&
    (signals.hasAuthenticatedNavigation || /^\/Aluno(?:\/|$)/i.test(url.pathname))
  ) {
    return 'AUTHENTICATED';
  }

  return 'UNKNOWN';
}
