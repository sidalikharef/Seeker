import { describe, expect, it } from 'vitest';
import {
  ALLOW_SESSION,
  RUN_ONCE,
  SessionCommandAllowlist,
  applyApprovalChoice,
  buildApprovalPrompt,
  exactCommandKey,
  formatExactCommand,
  isValidExactCommand,
} from '../../../src/security/approvals';
import type { ExactCommand, PermissionRequest } from '../../../src/tools/types';

const command: ExactCommand = {
  workspace: '/workspace',
  file: '/workspace/node_modules/.bin/tsc',
  args: ['--noEmit', '-p', 'tsconfig.json'],
  cwd: '/workspace',
};

function request(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    sessionId: 'session-a',
    toolId: 'terminal.execute',
    permission: 'execute',
    summary: 'Run typecheck',
    risk: 'high',
    command,
    ...overrides,
  };
}

describe('exact command approvals', () => {
  it('formats every exact command component for display', () => {
    const text = formatExactCommand(command);

    expect(text).toContain(`Executable: ${command.file}`);
    expect(text).toContain(`Arguments: ${JSON.stringify(command.args)}`);
    expect(text).toContain(`Working directory: ${command.cwd}`);
    expect(text).toContain(`Workspace: ${command.workspace}`);
  });

  it('offers one-time and session scope only for exact commands', () => {
    expect(buildApprovalPrompt(request()).items).toEqual([RUN_ONCE, ALLOW_SESSION]);
    expect(buildApprovalPrompt(request({ command: undefined })).items).toEqual([RUN_ONCE]);
  });

  it('stores session approval only after the session choice', () => {
    const approvals = new SessionCommandAllowlist();

    expect(applyApprovalChoice(undefined, request(), approvals)).toBe(false);
    expect(approvals.size).toBe(0);

    expect(applyApprovalChoice(RUN_ONCE, request(), approvals)).toBe(true);
    expect(approvals.size).toBe(0);

    expect(applyApprovalChoice(ALLOW_SESSION, request(), approvals)).toBe(true);
    expect(approvals.isAllowed('session-a', command)).toBe(true);
    expect(approvals.isAllowed('session-b', command)).toBe(false);
  });

  it('does not grant a session rule for generic or invalid requests', () => {
    const approvals = new SessionCommandAllowlist();

    expect(applyApprovalChoice(ALLOW_SESSION, request({ command: undefined }), approvals)).toBe(
      false,
    );
    expect(
      applyApprovalChoice(
        ALLOW_SESSION,
        request({ command: { ...command, args: undefined } as never }),
        approvals,
      ),
    ).toBe(false);
    expect(approvals.size).toBe(0);
  });

  it('matches only the exact executable, arguments, cwd, and workspace', () => {
    const approvals = new SessionCommandAllowlist();
    approvals.allow('session-a', command);

    expect(approvals.isAllowed('session-a', command)).toBe(true);
    expect(
      approvals.isAllowed('session-a', { ...command, args: [...command.args, '--watch'] }),
    ).toBe(false);
    expect(approvals.isAllowed('session-a', { ...command, file: '/usr/bin/tsc' })).toBe(false);
    expect(approvals.isAllowed('session-a', { ...command, cwd: '/workspace/sub' })).toBe(false);
    expect(approvals.isAllowed('session-a', { ...command, workspace: '/other-workspace' })).toBe(
      false,
    );
  });

  it('clears session rules and rejects invalid command records', () => {
    const approvals = new SessionCommandAllowlist();
    approvals.allow('session-a', command);

    approvals.clearSession('session-a');
    expect(approvals.isAllowed('session-a', command)).toBe(false);

    approvals.allow('session-a', command);
    approvals.clear();
    expect(approvals.size).toBe(0);

    expect(() => exactCommandKey({ ...command, file: '' })).toThrow('Invalid exact command');
    expect(isValidExactCommand({ ...command, args: ['ok', 1] })).toBe(false);
  });
});
