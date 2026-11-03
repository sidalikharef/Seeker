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

export type AgentErrorClass =
  | 'transient'
  | 'quota'
  | 'auth'
  | 'capability'
  | 'context'
  | 'tool'
  | 'permission'
  | 'invalid_tool_call'
  | 'fatal'
  | 'cancelled';

export interface AgentErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
  class: AgentErrorClass;
}

export class AgentError extends SeekerError {
  readonly agentClass: AgentErrorClass;
  readonly agentCode: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    agentClass: AgentErrorClass,
    options: { code?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, 'provider', options.cause ? { cause: options.cause } : undefined);
    this.name = 'AgentError';
    this.agentClass = agentClass;
    this.agentCode = options.code ?? agentClass;
    this.retryable = options.retryable ?? agentClass === 'transient';
  }
}

export function agentErrorInfo(error: unknown): AgentErrorInfo {
  if (error instanceof AgentError) {
    return {
      code: error.agentCode,
      message: error.message,
      retryable: error.retryable,
      class: error.agentClass,
    };
  }
  if (error instanceof SeekerError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.code === 'network' || error.code === 'timeout',
      class: error.code === 'cancelled' ? 'cancelled' : 'fatal',
    };
  }
  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    class: 'fatal',
  };
}

export function classifyProviderError(error: {
  kind: string;
  retryable: boolean;
  message: string;
}): AgentError {
  switch (error.kind) {
    case 'cancelled':
      return new AgentError(error.message, 'cancelled', { code: 'cancelled' });
    case 'rate_limit':
    case 'server':
    case 'network':
    case 'timeout':
      return new AgentError(error.message, 'transient', {
        code: error.kind,
        retryable: error.retryable,
      });
    case 'quota_exhausted':
      return new AgentError(error.message, 'quota', { code: error.kind });
    case 'auth':
      return new AgentError(error.message, 'auth', { code: error.kind });
    case 'capability':
      return new AgentError(error.message, 'capability', { code: error.kind });
    case 'context_overflow':
      return new AgentError(error.message, 'context', { code: error.kind });
    case 'bad_request':
    case 'model_not_found':
      return new AgentError(error.message, 'capability', { code: error.kind });
    default:
      return new AgentError(error.message, 'fatal', { code: 'provider', retryable: false });
  }
}

export function retryDelayMs(error: { retryAfterMs?: number }, attempt: number): number {
  if (error.retryAfterMs !== undefined && error.retryAfterMs >= 0) {
    return Math.min(error.retryAfterMs, 30_000);
  }
  return Math.min(250 * 2 ** Math.max(attempt - 1, 0), 5_000);
}
