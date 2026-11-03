import { stableStringify } from '../shared/hash';
import type { ExactCommand, PermissionRequest } from '../tools/types';

export type ApprovalScope = 'once' | 'session';
export const RUN_ONCE = 'Run once';
export const ALLOW_SESSION = 'Allow for this session';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidExactCommand(value: unknown): value is ExactCommand {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.workspace === 'string' &&
    value.workspace.length > 0 &&
    typeof value.file === 'string' &&
    value.file.length > 0 &&
    Array.isArray(value.args) &&
    value.args.every((arg) => typeof arg === 'string') &&
    typeof value.cwd === 'string' &&
    value.cwd.length > 0
  );
}

export function exactCommandKey(command: ExactCommand): string {
  if (!isValidExactCommand(command)) {
    throw new Error('Invalid exact command approval.');
  }
  return stableStringify({
    workspace: command.workspace,
    file: command.file,
    args: command.args,
    cwd: command.cwd,
  });
}

export function formatExactCommand(command: ExactCommand): string {
  return [
    `Executable: ${command.file}`,
    `Arguments: ${JSON.stringify(command.args)}`,
    `Working directory: ${command.cwd}`,
    `Workspace: ${command.workspace}`,
  ].join('\n');
}

export interface ApprovalPrompt {
  message: string;
  items: string[];
}

export function buildApprovalPrompt(request: PermissionRequest): ApprovalPrompt {
  const command = request.command;
  if (!command || !isValidExactCommand(command)) {
    return {
      message: [
        'Seeker needs permission for this action.',
        '',
        request.summary,
        '',
        `Tool: ${request.toolId}`,
        `Risk: ${request.risk}`,
      ].join('\n'),
      items: [RUN_ONCE],
    };
  }

  return {
    message: [
      'Seeker wants to run this exact command.',
      '',
      formatExactCommand(command),
      '',
      `Risk: ${request.risk}`,
      'Command arguments are executed without a shell. Review every argument carefully.',
    ].join('\n'),
    items: [RUN_ONCE, ALLOW_SESSION],
  };
}

export function applyApprovalChoice(
  choice: string | undefined,
  request: PermissionRequest,
  approvals: SessionCommandAllowlist,
): boolean {
  const command = request.command;
  if (command && !isValidExactCommand(command)) {
    return false;
  }
  if (choice === RUN_ONCE) {
    return true;
  }
  if (choice === ALLOW_SESSION && command && isValidExactCommand(command)) {
    approvals.allow(request.sessionId, command);
    return true;
  }
  return false;
}

export class SessionCommandAllowlist {
  private readonly sessions = new Map<string, Map<string, ExactCommand>>();

  allow(sessionId: string, command: ExactCommand): void {
    if (!sessionId) {
      throw new Error('A session ID is required for a session command approval.');
    }
    let commands = this.sessions.get(sessionId);
    if (!commands) {
      commands = new Map();
      this.sessions.set(sessionId, commands);
    }
    commands.set(exactCommandKey(command), clone(command));
  }

  isAllowed(sessionId: string, command: ExactCommand): boolean {
    return this.sessions.get(sessionId)?.has(exactCommandKey(command)) ?? false;
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  clear(): void {
    this.sessions.clear();
  }

  get size(): number {
    let size = 0;
    for (const commands of this.sessions.values()) {
      size += commands.size;
    }
    return size;
  }
}

function clone(command: ExactCommand): ExactCommand {
  return {
    workspace: command.workspace,
    file: command.file,
    args: [...command.args],
    cwd: command.cwd,
  };
}
