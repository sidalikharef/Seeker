import * as vscode from 'vscode';
import type { DiagnosticRecord, DiagnosticsReader } from '../tools/diagnostics';

function severityName(severity: vscode.DiagnosticSeverity): DiagnosticRecord['severity'] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'information';
    case vscode.DiagnosticSeverity.Hint:
      return 'hint';
    default:
      return 'information';
  }
}

export class VscodeDiagnosticsReader implements DiagnosticsReader {
  async get(absolutePath?: string): Promise<DiagnosticRecord[]> {
    const results: DiagnosticRecord[] = [];
    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      if (absolutePath && uri.fsPath !== absolutePath) {
        continue;
      }
      if (!vscode.workspace.getWorkspaceFolder(uri)) {
        continue;
      }
      const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
      for (const diagnostic of diagnostics) {
        const code =
          typeof diagnostic.code === 'string' || typeof diagnostic.code === 'number'
            ? String(diagnostic.code)
            : diagnostic.code?.value?.toString();
        results.push({
          path: relative,
          message: diagnostic.message,
          severity: severityName(diagnostic.severity),
          source: diagnostic.source,
          code,
          range: {
            start: {
              line: diagnostic.range.start.line,
              character: diagnostic.range.start.character,
            },
            end: {
              line: diagnostic.range.end.line,
              character: diagnostic.range.end.character,
            },
          },
        });
      }
    }
    return results;
  }
}
