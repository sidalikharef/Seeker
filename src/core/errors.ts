export type SeekerErrorCode =
  | 'configuration'
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'parse'
  | 'protocol'
  | 'provider'
  | 'unknown';

export class SeekerError extends Error {
  readonly code: SeekerErrorCode;

  constructor(message: string, code: SeekerErrorCode, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SeekerError';
    this.code = code;
  }
}

export class ConfigurationError extends SeekerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'configuration', options);
    this.name = 'ConfigurationError';
  }
}
