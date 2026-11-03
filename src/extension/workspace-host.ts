import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { FileAuditLogger } from '../security/audit';
import { SessionCommandAllowlist } from '../security/approvals';
import type { Tool } from '../tools/types';
import { ToolDispatcher } from '../tools/dispatcher';
import { createDiagnosticsTool } from '../tools/diagnostics';
import { filesystemTools } from '../tools/filesystem';
import { gitTools } from '../tools/git';
import { DefaultPermissionManager, SessionAwarePermissionManager } from '../tools/permissions';
import { ToolRegistry } from '../tools/registry';
import { searchTools } from '../tools/search';
import { terminalTools } from '../tools/terminal';
import type {
  AuditLogger,
  DiffPreviewer,
  PermissionManager,
  PermissionRequest,
  ToolContext,
  ToolMode,
} from '../tools/types';
import { VscodeCommandApprover } from './command-approval';
import { VscodeDiagnosticsReader } from './diagnostics';
import { VscodeDiffPreviewer } from './diff-preview';
import { formatCommandForAudit } from '../security/commands';

export interface WorkspaceToolHostOptions {
  context: vscode.ExtensionContext;
  sessionId?: string;
  mode?: ToolMode;
  permissions?: PermissionManager;
  preview?: DiffPreviewer;
  logger?: AuditLogger;
  output?: vscode.OutputChannel;
  approvals?: SessionCommandAllowlist;
  approve?: (request: PermissionRequest) => Promise<boolean>;
}

export interface WorkspaceToolContextOptions {
  signal: AbortSignal;
  sessionId?: string;
  mode?: ToolMode;
  permissions?: PermissionManager;
  preview?: DiffPreviewer;
  logger?: AuditLogger;
  allowSensitivePaths?: boolean;
  approve?: (request: PermissionRequest) => Promise<boolean>;
}

export class WorkspaceToolHost {
  readonly registry: ToolRegistry;
  readonly dispatcher: ToolDispatcher;
  readonly approvals: SessionCommandAllowlist;
  private readonly auditLogger: AuditLogger;
  private readonly diagnosticsReader = new VscodeDiagnosticsReader();
  private readonly defaultPermissions: PermissionManager;
  private readonly defaultApprove: (request: PermissionRequest) => Promise<boolean>;
  private readonly defaultPreview: DiffPreviewer;
  private readonly sessionId: string;
  private readonly mode: ToolMode;
  private readonly output: vscode.OutputChannel | undefined;

  constructor(options: WorkspaceToolHostOptions) {
    this.output = options.output;
    this.sessionId = options.sessionId ?? randomUUID();
    this.mode = options.mode ?? 'ask';
    this.approvals = options.approvals ?? new SessionCommandAllowlist();
    this.defaultPermissions = new SessionAwarePermissionManager(
      vscode.workspace.isTrusted,
      options.permissions ?? new DefaultPermissionManager(),
      this.approvals,
    );
    const approver = options.approve ? undefined : new VscodeCommandApprover(this.approvals);
    this.defaultApprove = options.approve ?? ((request) => approver!.approve(request));
    this.defaultPreview = options.preview ?? new VscodeDiffPreviewer();
    this.auditLogger =
      options.logger ??
      new FileAuditLogger(
        join(options.context.globalStorageUri.fsPath, 'audit', 'tool-actions.jsonl'),
      );

    this.registry = new ToolRegistry();
    const tools: Tool[] = [
      ...(filesystemTools as Tool[]),
      ...(searchTools as Tool[]),
      ...(gitTools as Tool[]),
      ...(terminalTools as Tool[]),
      createDiagnosticsTool(this.diagnosticsReader),
    ];
    for (const tool of tools) {
      this.registry.register(tool);
    }
    this.dispatcher = new ToolDispatcher(this.registry);
  }

  get workspaceRoots(): string[] {
    return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  }

  createContext(options: WorkspaceToolContextOptions): ToolContext {
    return {
      sessionId: options.sessionId ?? this.sessionId,
      workspaceRoots: this.workspaceRoots,
      signal: options.signal,
      logger: options.logger ?? this.auditLogger,
      permissions: options.permissions ?? this.defaultPermissions,
      mode: options.mode ?? this.mode,
      preview: options.preview ?? this.defaultPreview,
      allowSensitivePaths: options.allowSensitivePaths,
      approve: options.approve ?? this.defaultApprove,
    };
  }

  execute(
    toolId: string,
    argumentsValue: unknown,
    options: WorkspaceToolContextOptions,
  ): ReturnType<ToolDispatcher['execute']> {
    const result = this.dispatcher.execute(toolId, argumentsValue, this.createContext(options));
    if (toolId === 'terminal.execute') {
      this.logTerminal(argumentsValue, result);
    }
    return result;
  }

  private logTerminal(
    argumentsValue: unknown,
    result: ReturnType<ToolDispatcher['execute']>,
  ): void {
    if (!this.output) {
      return;
    }
    const input =
      typeof argumentsValue === 'object' && argumentsValue !== null
        ? (argumentsValue as Record<string, unknown>)
        : {};
    const file = typeof input.file === 'string' ? input.file : '';
    const args = Array.isArray(input.args)
      ? input.args.filter((arg): arg is string => typeof arg === 'string')
      : [];
    const cwd = typeof input.cwd === 'string' ? input.cwd : '.';
    const command = formatCommandForAudit(file, args, cwd);
    this.output.appendLine(
      `[terminal] ${command.file} ${command.args.join(' ')} (cwd=${command.cwd})`,
    );
    void result.then((toolResult) => {
      const details = toolResult.ok
        ? (toolResult.data as Record<string, unknown>)
        : (toolResult.error.details as Record<string, unknown> | undefined);
      const exitCode = details?.exitCode ?? 'unknown';
      const durationMs = details?.durationMs ?? 'unknown';
      const stdoutBytes = details?.stdoutBytes ?? 0;
      const stderrBytes = details?.stderrBytes ?? 0;
      const truncated = details?.stdoutTruncated === true || details?.stderrTruncated === true;
      this.output?.appendLine(
        `[terminal] ${toolResult.ok ? 'ok' : toolResult.error.code} exit=${String(exitCode)} duration=${String(durationMs)}ms stdout=${String(stdoutBytes)}B stderr=${String(stderrBytes)}B${truncated ? ' truncated' : ''}`,
      );
    });
  }
}
