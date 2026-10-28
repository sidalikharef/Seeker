import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('deepcode.hello', () => {
    vscode.window.showInformationMessage('DeepCode is alive.');
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}