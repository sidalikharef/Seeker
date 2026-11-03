import * as vscode from 'vscode';
import {
  applyApprovalChoice,
  buildApprovalPrompt,
  isValidExactCommand,
  type SessionCommandAllowlist,
} from '../security/approvals';
import type { PermissionRequest } from '../tools/types';

export interface ApprovalUi {
  showWarningMessage(
    message: string,
    options: vscode.MessageOptions,
    ...items: string[]
  ): Thenable<string | undefined>;
}

export class VscodeCommandApprover {
  constructor(
    private readonly approvals: SessionCommandAllowlist,
    private readonly ui: ApprovalUi = vscode.window,
  ) {}

  async approve(request: PermissionRequest): Promise<boolean> {
    if (request.command && !isValidExactCommand(request.command)) {
      return false;
    }
    const prompt = buildApprovalPrompt(request);
    const choice = await this.ui.showWarningMessage(
      prompt.message,
      { modal: true },
      ...prompt.items,
    );
    return applyApprovalChoice(choice, request, this.approvals);
  }
}
