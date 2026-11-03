import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { COMMANDS } from '../shared/commands';
import { CONFIG_KEYS, CONFIG_SECTION } from '../shared/configuration';
import { redactSecrets } from '../shared/redaction';
import type { ChatService } from './chat-service';
import { parseWebviewMessage, type HostToWebview, type WebviewToHost } from './webview/protocol';
import { buildWebviewCsp } from './webview/security';

export const CHAT_VIEW_ID = 'seeker.chat';

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private subscription?: () => void;
  private messageDisposable?: vscode.Disposable;
  private stateRevision = 0;
  private ready = false;
  private readonly extensionUri: vscode.Uri;
  private readonly extensionId: string;

  constructor(
    extensionUri: vscode.Uri,
    extensionId: string,
    private readonly service: ChatService,
  ) {
    this.extensionUri = extensionUri;
    this.extensionId = extensionId;
    this.subscription = this.service.subscribe((event) => {
      if (!this.view) {
        return;
      }
      if (event.type === 'state') {
        void this.postState('state');
      } else {
        this.post(event);
      }
    });
  }

  dispose(): void {
    this.subscription?.();
    this.subscription = undefined;
    this.messageDisposable?.dispose();
    this.messageDisposable = undefined;
    this.view = undefined;
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    this.ready = false;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    this.messageDisposable?.dispose();
    this.messageDisposable = webviewView.webview.onDidReceiveMessage((raw: unknown) => {
      void this.handleMessage(raw);
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.postState('state');
        void this.service.ensureModels();
      }
    });
    webviewView.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
  }

  refreshState(): void {
    void this.postState(this.ready ? 'state' : 'init');
  }

  private post(event: HostToWebview): void {
    if (!this.view) {
      return;
    }
    void this.view.webview.postMessage(event);
  }

  private async postState(type: 'init' | 'state'): Promise<void> {
    if (!this.view) {
      return;
    }
    const revision = ++this.stateRevision;
    try {
      const state = await this.service.getPublicState();
      if (revision !== this.stateRevision || !this.view) {
        return;
      }
      this.post({ type, state });
    } catch (error) {
      this.post({
        type: 'error',
        message: this.errorText(error),
        recoverable: true,
        actions: ['settings'],
      });
    }
  }

  private errorText(error: unknown): string {
    return redactSecrets(error instanceof Error ? error.message : String(error));
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const message = parseWebviewMessage(raw);
    if (!message) {
      this.post({
        type: 'error',
        message: 'Seeker ignored an invalid or unsupported webview message.',
        recoverable: false,
        actions: [],
      });
      return;
    }

    try {
      await this.dispatch(message);
    } catch (error) {
      const messageText = this.errorText(error);
      this.post({
        type: 'error',
        message: messageText,
        recoverable: true,
        actions: ['settings'],
      });
    }
  }

  private async dispatch(message: WebviewToHost): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await this.postState('init');
        await this.service.ensureModels();
        return;
      case 'chat.send':
        await this.service.send(message);
        return;
      case 'chat.cancel':
        this.service.cancel(message.requestId);
        return;
      case 'chat.retry':
        await this.service.retry(message.requestId);
        return;
      case 'model.select':
        this.service.selectModel(message.provider, message.modelId);
        return;
      case 'model.auto':
        this.service.clearSelection();
        return;
      case 'mode.set':
        this.service.setMode(message.mode);
        return;
      case 'models.refresh':
        await this.service.refreshModels();
        return;
      case 'credentials.manage':
        await vscode.commands.executeCommand(
          message.action === 'set' ? COMMANDS.setApiKey : COMMANDS.clearApiKey,
          message.provider,
        );
        await this.service.ensureModels(true);
        return;
      case 'settings.update': {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        if (message.key === 'policy') {
          await config.update(
            CONFIG_KEYS.routingPolicy,
            message.value,
            vscode.ConfigurationTarget.Global,
          );
        } else {
          await config.update(
            CONFIG_KEYS.routingPreferredProvider,
            message.value,
            vscode.ConfigurationTarget.Global,
          );
        }
        this.service.notifyState();
        return;
      }
      case 'settings.open':
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          `@ext:${this.extensionId}`,
        );
        return;
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'main.js'),
    );
    const stylePath = vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.css').fsPath;
    const style = readFileSync(stylePath, 'utf8');
    const csp = buildWebviewCsp(nonce, webview.cspSource);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Seeker</title>
  <style nonce="${nonce}">${style}</style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true">S</span><span>Seeker</span></div>
      <div class="topbar-actions">
        <span id="provider-summary" class="provider-summary">No provider configured</span>
        <button id="refresh-models" class="icon-button" type="button" title="Refresh free models" aria-label="Refresh free models">Refresh</button>
        <button id="settings-toggle" class="icon-button" type="button" aria-expanded="false" aria-controls="settings-panel">Settings</button>
      </div>
    </header>
    <main id="messages" class="messages" role="log" aria-live="polite" aria-relevant="additions text">
      <div id="empty-state" class="empty-state">
        <h1>Ask Seeker about your code</h1>
        <p>Free cloud models are selected automatically. Add an OpenRouter or Groq key in Settings to start.</p>
      </div>
    </main>
    <div id="error-banner" class="error-banner" role="alert" hidden>
      <div id="error-text" class="error-text"></div>
      <div id="error-actions" class="error-actions"></div>
      <button id="error-close" class="icon-button error-close" type="button" aria-label="Dismiss error">Dismiss</button>
    </div>
    <form id="composer" class="composer">
      <label class="sr-only" for="prompt">Message</label>
      <textarea id="prompt" class="prompt" rows="3" placeholder="Ask about your code, an error, or a change..." aria-describedby="composer-hint"></textarea>
      <div class="composer-row">
        <div class="composer-meta">
          <label class="sr-only" for="mode-select">Mode</label>
          <select id="mode-select" class="select" title="Mode">
            <option value="ask">Ask</option>
            <option value="plan">Plan</option>
            <option value="review">Review</option>
            <option value="build">Build</option>
            <option value="debug">Debug</option>
          </select>
          <label class="sr-only" for="model-select">Model</label>
          <select id="model-select" class="select model-select" title="Model">
            <option value="auto">Auto (free-first)</option>
          </select>
        </div>
        <div class="composer-actions">
          <span id="composer-hint" class="composer-hint">Enter to send</span>
          <button id="stop" class="secondary danger" type="button" hidden>Stop</button>
          <button id="send" class="primary" type="submit">Send</button>
        </div>
      </div>
    </form>
    <aside id="settings-panel" class="settings-panel" role="dialog" aria-modal="true" aria-label="Seeker settings" hidden>
      <div class="settings-header">
        <h2>Settings</h2>
        <button id="settings-close" class="icon-button" type="button" aria-label="Close settings">Close</button>
      </div>
      <div class="settings-body">
        <section class="settings-section">
          <h3>Routing</h3>
          <label class="field-label" for="policy-select">Policy</label>
          <select id="policy-select" class="select">
            <option value="free-first">Free first</option>
            <option value="automatic">Automatic</option>
            <option value="fast">Fast</option>
            <option value="coding">Coding</option>
            <option value="reasoning">Reasoning</option>
            <option value="manual">Manual</option>
          </select>
          <label class="field-label" for="preferred-provider">Preferred provider</label>
          <select id="preferred-provider" class="select">
            <option value="">Any provider</option>
          </select>
          <p class="hint">Paid models stay disabled unless you enable them in VS Code settings. Manual routing uses the selected model or the preferred model from full settings. Ask, Plan, and Review are read-only. Build and Debug can use workspace tools after approval.</p>
        </section>
        <section class="settings-section">
          <h3>Providers</h3>
          <div id="provider-settings" class="provider-settings"></div>
        </section>
        <section class="settings-section">
          <h3>Privacy</h3>
          <p class="hint">API keys are stored only in VS Code SecretStorage and are sent only to the selected provider. Model output is rendered as text, never as executable HTML.</p>
          <button id="open-settings" class="secondary" type="button">Open full settings</button>
        </section>
      </div>
    </aside>
    <div id="tool-activity" class="tool-activity" aria-label="Activity" hidden></div>
    <div id="announcer" class="sr-only" aria-live="polite"></div>
  </div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}
