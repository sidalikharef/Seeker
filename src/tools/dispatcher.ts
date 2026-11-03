import { sha256Hex, stableStringify } from '../shared/hash';
import { redactSecrets } from '../shared/redaction';
import { validateJsonSchema } from './schema';
import type { ToolRegistry } from './registry';
import {
  failure,
  toolError,
  type AuditEntry,
  type PermissionClass,
  type PermissionRequest,
  type Tool,
  type ToolContext,
  type ToolResult,
} from './types';

const RISK: Record<PermissionClass, PermissionRequest['risk']> = {
  read: 'low',
  write: 'medium',
  execute: 'high',
  network: 'high',
  destructive: 'high',
};

function pathsFromArguments(args: unknown): string[] | undefined {
  if (typeof args !== 'object' || args === null) {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  const path = typeof record.path === 'string' ? record.path : undefined;
  return path ? [path] : undefined;
}

function resultBytes(result: ToolResult<unknown>): number | undefined {
  if (!result.ok) {
    return undefined;
  }
  try {
    return Buffer.byteLength(JSON.stringify(result.data), 'utf8');
  } catch {
    return undefined;
  }
}

function errorStatus(errorCode: string): AuditEntry['status'] {
  return errorCode === 'cancelled' || errorCode === 'timeout' ? 'cancelled' : 'error';
}

export class ToolDispatcher {
  constructor(private readonly registry: ToolRegistry) {}

  async execute(
    toolId: string,
    rawArguments: unknown,
    ctx: ToolContext,
  ): Promise<ToolResult<unknown>> {
    const tool = this.registry.get(toolId);
    if (!tool) {
      return failure('invalid_arguments', `Unknown tool: ${toolId}`);
    }

    if (ctx.mode && !this.registry.isAllowedInMode(tool, ctx.mode)) {
      return failure('permission_denied', `Tool ${tool.id} is not available in ${ctx.mode} mode.`);
    }

    const validationErrors = validateJsonSchema(tool.inputSchema, rawArguments);
    if (validationErrors.length > 0) {
      return failure('invalid_arguments', 'Invalid tool arguments.', {
        details: { errors: validationErrors },
      });
    }

    if (ctx.signal.aborted) {
      return failure('cancelled', 'The operation was cancelled.', { retryable: true });
    }

    let preflight: Awaited<ReturnType<NonNullable<Tool['preflight']>>> | undefined;
    if (tool.preflight) {
      try {
        preflight = await tool.preflight(rawArguments as never, ctx);
      } catch (error) {
        return failure(
          'internal',
          redactSecrets(error instanceof Error ? error.message : String(error)),
        );
      }
      if (preflight.failure) {
        return preflight.failure;
      }
    }

    const startedAt = Date.now();
    const argumentHash = sha256Hex(stableStringify(rawArguments));
    const permissionRequest: PermissionRequest = {
      sessionId: ctx.sessionId,
      toolId: tool.id,
      permission: tool.permission,
      summary: preflight?.summary ?? tool.description,
      risk: RISK[tool.permission],
      paths: preflight?.paths ?? pathsFromArguments(rawArguments),
      ...(preflight?.command ? { command: preflight.command } : {}),
    };

    let decision: AuditEntry['decision'];
    let allowed = false;
    try {
      const permission = await ctx.permissions.authorize(permissionRequest);
      if (permission === 'allow') {
        allowed = true;
        decision = 'allow';
      } else if (permission === 'ask') {
        allowed = ctx.approve ? await ctx.approve(permissionRequest) : false;
        decision = allowed ? 'user_approved' : 'user_rejected';
      } else {
        decision = 'deny';
      }
    } catch {
      decision = 'deny';
    }

    if (!allowed) {
      const error = toolError('permission_denied', `Permission denied for ${tool.id}.`);
      let details: Record<string, unknown> | undefined;
      if (tool.auditMetadata) {
        try {
          details = tool.auditMetadata(rawArguments as never, { ok: false, error } as never);
        } catch {
          details = undefined;
        }
      }
      await this.record(ctx, {
        at: new Date().toISOString(),
        sessionId: ctx.sessionId,
        toolId: tool.id,
        argumentHash,
        permission: tool.permission,
        decision,
        status: 'error',
        durationMs: Date.now() - startedAt,
        errorCode: error.code,
        ...(details ? { details } : {}),
      });
      return { ok: false, error };
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = () => controller.abort(ctx.signal.reason);
    ctx.signal.addEventListener('abort', abortFromParent, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('timeout'));
    }, tool.timeoutMs);

    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
    });

    let result: ToolResult<unknown>;
    try {
      result = await Promise.race([
        tool.execute(rawArguments as never, { ...ctx, signal: controller.signal }),
        aborted,
      ]);
    } catch (error) {
      if (timedOut) {
        result = failure('timeout', `Tool ${tool.id} timed out after ${tool.timeoutMs} ms.`, {
          retryable: true,
        });
      } else if (ctx.signal.aborted) {
        result = failure('cancelled', 'The operation was cancelled.', { retryable: true });
      } else {
        result = failure(
          'internal',
          redactSecrets(error instanceof Error ? error.message : String(error)),
        );
      }
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', abortFromParent);
    }

    const status = result.ok ? 'ok' : errorStatus(result.error.code);
    let details: Record<string, unknown> | undefined;
    if (tool.auditMetadata) {
      try {
        details = tool.auditMetadata(rawArguments as never, result as never);
      } catch {
        details = undefined;
      }
    }
    await this.record(ctx, {
      at: new Date().toISOString(),
      sessionId: ctx.sessionId,
      toolId: tool.id,
      argumentHash,
      permission: tool.permission,
      decision,
      status,
      durationMs: Date.now() - startedAt,
      resultBytes: resultBytes(result),
      errorCode: result.ok ? undefined : result.error.code,
      ...(details ? { details } : {}),
    });

    if (result.ok && result.truncated !== undefined) {
      return result;
    }
    return result;
  }

  private async record(ctx: ToolContext, entry: AuditEntry): Promise<void> {
    try {
      await ctx.logger.record(entry);
    } catch {
      // Audit failures must not turn a safe tool result into a crash.
    }
  }

  getTool(toolId: string): Tool | undefined {
    return this.registry.get(toolId);
  }
}
