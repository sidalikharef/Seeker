export type PermissionClass = 'read' | 'write' | 'execute' | 'network' | 'destructive';

export type ToolMode = 'ask' | 'plan' | 'build' | 'debug' | 'review';

export type JsonSchemaType =
  'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
}

export type ToolErrorCode =
  | 'invalid_arguments'
  | 'permission_denied'
  | 'not_found'
  | 'conflict'
  | 'timeout'
  | 'cancelled'
  | 'too_large'
  | 'unsafe_path'
  | 'command_failed'
  | 'internal';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}

export type ToolResult<T> =
  { ok: true; data: T; truncated?: boolean; bytes?: number } | { ok: false; error: ToolError };

export interface AuditEntry {
  at: string;
  sessionId: string;
  toolId: string;
  argumentHash: string;
  permission: PermissionClass;
  decision: 'allow' | 'deny' | 'user_approved' | 'user_rejected';
  status: 'ok' | 'error' | 'cancelled';
  durationMs: number;
  resultBytes?: number;
  errorCode?: string;
  details?: Record<string, unknown>;
}

export interface AuditLogger {
  record(entry: AuditEntry): void | Promise<void>;
}

export interface ExactCommand {
  workspace: string;
  file: string;
  args: string[];
  cwd: string;
}

export interface ToolPreflightResult {
  summary?: string;
  paths?: string[];
  command?: ExactCommand;
  failure?: ToolResult<never>;
}

export interface PermissionRequest {
  sessionId: string;
  toolId: string;
  permission: PermissionClass;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  paths?: string[];
  diff?: string;
  command?: ExactCommand;
}

export type PermissionDecision = 'allow' | 'deny' | 'ask';

export interface PermissionManager {
  authorize(request: PermissionRequest): Promise<PermissionDecision>;
}

export interface DiffPreviewRequest {
  path: string;
  before: string;
  after: string;
  language?: string;
}

export interface DiffPreviewer {
  preview(request: DiffPreviewRequest): Promise<boolean>;
}

export interface ToolContext {
  sessionId: string;
  workspaceRoots: string[];
  signal: AbortSignal;
  logger: AuditLogger;
  permissions: PermissionManager;
  mode?: ToolMode;
  allowSensitivePaths?: boolean;
  approve?: (request: PermissionRequest) => Promise<boolean>;
  preview?: DiffPreviewer;
  now?: () => number;
}

export interface Tool<Input = unknown, Output = unknown> {
  id: string;
  description: string;
  permission: PermissionClass;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  timeoutMs: number;
  maxResultBytes: number;
  idempotent: boolean;
  preflight?(input: Input, ctx: ToolContext): Promise<ToolPreflightResult>;
  execute(input: Input, ctx: ToolContext): Promise<ToolResult<Output>>;
  auditMetadata?(input: Input, result: ToolResult<Output>): Record<string, unknown> | undefined;
}

export function toolError(
  code: ToolErrorCode,
  message: string,
  options: { retryable?: boolean; details?: Record<string, unknown> } = {},
): ToolError {
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    ...(options.details ? { details: options.details } : {}),
  };
}

export function failure(
  code: ToolErrorCode,
  message: string,
  options: { retryable?: boolean; details?: Record<string, unknown> } = {},
): ToolResult<never> {
  return { ok: false, error: toolError(code, message, options) };
}
