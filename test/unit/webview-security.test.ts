import { describe, expect, it } from 'vitest';
import { buildWebviewCsp } from '../../src/extension/webview/security';

describe('webview CSP', () => {
  it('uses a nonce and blocks network, inline scripts, and remote resources', () => {
    const csp = buildWebviewCsp('abc123', 'vscode-webview://source');

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-abc123'");
    expect(csp).toContain("style-src 'nonce-abc123'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain('img-src vscode-webview://source data:');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('http:');
    expect(csp).not.toContain('https:');
  });
});
