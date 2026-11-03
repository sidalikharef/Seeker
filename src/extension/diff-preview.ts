import { extname } from 'node:path';
import * as vscode from 'vscode';
import type { DiffPreviewer, DiffPreviewRequest } from '../tools/types';

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.html': 'html',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cs': 'csharp',
  '.sh': 'shellscript',
  '.yml': 'yaml',
  '.yaml': 'yaml',
};

export class VscodeDiffPreviewer implements DiffPreviewer {
  async preview(request: DiffPreviewRequest): Promise<boolean> {
    const language =
      request.language ?? LANGUAGE_BY_EXTENSION[extname(request.path)] ?? 'plaintext';
    const before = await vscode.workspace.openTextDocument({
      content: request.before,
      language,
    });
    const after = await vscode.workspace.openTextDocument({
      content: request.after,
      language,
    });

    await vscode.commands.executeCommand(
      'vscode.diff',
      before.uri,
      after.uri,
      `Seeker: ${request.path} (proposed)`,
    );
    const choice = await vscode.window.showWarningMessage(
      `Apply the proposed change to ${request.path}?`,
      { modal: true },
      'Apply',
    );
    return choice === 'Apply';
  }
}
