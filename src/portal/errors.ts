export type PortalErrorCode =
  | 'CREDENTIALS_MISSING'
  | 'CAPTCHA_OR_MFA'
  | 'LOGIN_REJECTED'
  | 'LOGIN_FORM_CHANGED'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'UNEXPECTED';

export class PortalError extends Error {
  constructor(
    public readonly code: PortalErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PortalError';
  }
}
