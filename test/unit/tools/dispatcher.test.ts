import { describe, expect, it, vi } from 'vitest';
import { MemoryAuditLogger } from '../../../src/security/audit';
import { ToolDispatcher } from '../../../src/tools/dispatcher';
import { ToolRegistry } from '../../../src/tools/registry';
import {
  failure,
  type PermissionManager,
  type Tool,
  type ToolResult,
} from '../../../src/tools/types';
import { AllowAllPermissionManager, DenyAllPermissionManager, createContext } from './helpers';

function echoTool(execute: Tool['execute'] = async (input) => ({ ok: true, data: input })): Tool {
  return {
    id: 'test.echo',
    description: 'Echo input.',
    permission: 'read',
    timeoutMs: 100,
    maxResultBytes: 1024,
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    execute,
  };
}

function build(tool: Tool, permissions: PermissionManager = new AllowAllPermissionManager()) {
  const registry = new ToolRegistry();
  registry.register(tool);
  const logger = new MemoryAuditLogger();
  const ctx = createContext('/tmp/workspace', { logger, permissions });
  return { dispatcher: new ToolDispatcher(registry), ctx, logger, registry };
}

describe('ToolDispatcher', () => {
  it('validates arguments before execution', async () => {
    const execute = vi.fn(async (): Promise<ToolResult<unknown>> => ({
      ok: true,
      data: { value: 'ok' },
    }));
    const { dispatcher, ctx } = build(echoTool(execute));

    const result = await dispatcher.execute('test.echo', { extra: true }, ctx);

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('enforces permission before execution and audits denials', async () => {
    const execute = vi.fn(async (): Promise<ToolResult<unknown>> => ({
      ok: true,
      data: { value: 'ok' },
    }));
    const permissions = new DenyAllPermissionManager();
    const { dispatcher, ctx, logger } = build(echoTool(execute), permissions);

    const result = await dispatcher.execute('test.echo', { value: 'x' }, ctx);

    expect(result).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    expect(execute).not.toHaveBeenCalled();
    expect(logger.entries).toEqual([
      expect.objectContaining({ toolId: 'test.echo', decision: 'deny', status: 'error' }),
    ]);
  });

  it('requires approval for ask decisions', async () => {
    const execute = vi.fn(async (): Promise<ToolResult<unknown>> => ({
      ok: true,
      data: { value: 'x' },
    }));
    const permissions: PermissionManager = { authorize: async () => 'ask' };
    const { dispatcher, ctx } = build(echoTool(execute), permissions);

    const denied = await dispatcher.execute('test.echo', { value: 'x' }, ctx);
    expect(denied).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    expect(execute).not.toHaveBeenCalled();

    const approved = await dispatcher.execute(
      'test.echo',
      { value: 'x' },
      {
        ...ctx,
        approve: async () => true,
      },
    );
    expect(approved).toMatchObject({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('runs preflight before permissions and never executes invalid commands', async () => {
    const execute = vi.fn(async (): Promise<ToolResult<unknown>> => ({
      ok: true,
      data: { value: 'x' },
    }));
    const permissions = new AllowAllPermissionManager();
    const tool: Tool = {
      ...echoTool(execute),
      preflight: async () => ({ failure: failure('unsafe_path', 'outside workspace') }),
    };
    const { dispatcher, ctx } = build(tool, permissions);

    const result = await dispatcher.execute('test.echo', { value: 'x' }, ctx);

    expect(result).toMatchObject({ ok: false, error: { code: 'unsafe_path' } });
    expect(permissions.requests).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes validated command details to permission approval', async () => {
    const execute = vi.fn(async (): Promise<ToolResult<unknown>> => ({
      ok: true,
      data: { value: 'x' },
    }));
    const permissions = new AllowAllPermissionManager();
    const command = {
      workspace: '/tmp/workspace',
      file: '/tmp/workspace/script.js',
      args: ['--check'],
      cwd: '/tmp/workspace',
    };
    const tool: Tool = {
      ...echoTool(execute),
      permission: 'execute',
      preflight: async () => ({ summary: 'Run checked script', command }),
    };
    const { dispatcher, ctx } = build(tool, permissions);

    await dispatcher.execute('test.echo', { value: 'x' }, ctx);

    expect(permissions.requests[0]).toMatchObject({
      summary: 'Run checked script',
      command,
    });
  });

  it('filters tools by mode', async () => {
    const writeTool: Tool = { ...echoTool(), id: 'test.write', permission: 'write' };
    const { dispatcher, ctx } = build(writeTool);

    const result = await dispatcher.execute('test.write', { value: 'x' }, { ...ctx, mode: 'ask' });

    expect(result).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
  });

  it('times out and audits cancelled work', async () => {
    const tool: Tool = {
      ...echoTool(
        () =>
          new Promise<ToolResult<unknown>>(() => {
            // Never resolves; the dispatcher must stop waiting.
          }),
      ),
      timeoutMs: 10,
    };
    const { dispatcher, ctx, logger } = build(tool);

    const result = await dispatcher.execute('test.echo', { value: 'x' }, ctx);

    expect(result).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(logger.entries.at(-1)).toMatchObject({ status: 'cancelled', errorCode: 'timeout' });
  });

  it('propagates cancellation without executing after abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn(async (): Promise<ToolResult<unknown>> => ({
      ok: true,
      data: { value: 'x' },
    }));
    const { dispatcher, ctx } = build(echoTool(execute));

    const result = await dispatcher.execute(
      'test.echo',
      { value: 'x' },
      {
        ...ctx,
        signal: controller.signal,
      },
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('stores argument hashes but not raw arguments', async () => {
    const { dispatcher, ctx, logger } = build(echoTool());

    await dispatcher.execute('test.echo', { value: 'sensitive-value' }, ctx);

    const entry = logger.entries[0];
    expect(entry.argumentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(entry)).not.toContain('sensitive-value');
  });

  it('converts thrown tool errors into internal failures', async () => {
    const { dispatcher, ctx } = build(
      echoTool(async () => {
        throw new Error('boom');
      }),
    );

    const result = await dispatcher.execute('test.echo', { value: 'x' }, ctx);

    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('returns structured tool failures unchanged', async () => {
    const { dispatcher, ctx } = build(echoTool(async () => failure('conflict', 'changed')));

    const result = await dispatcher.execute('test.echo', { value: 'x' }, ctx);

    expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
});
