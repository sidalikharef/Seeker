import * as vscode from 'vscode';
import { ChatService } from './extension/chat-service';
import { CHAT_VIEW_ID, ChatViewProvider } from './extension/chat-view';
import { registerSeekerCommands, type CommandUi } from './extension/commands';
import { resolveEnabledProviders } from './extension/provider-settings';
import { SecretStorageCredentialProvider } from './extension/secrets';
import { WorkspaceToolHost } from './extension/workspace-host';
import { ModelCatalog } from './providers/model-catalog';
import { createProviderAdapters } from './providers/registry';
import { PROVIDER_IDS } from './providers/types';
import { createDebugRequest, formatRoutingDebug, toRoutingSettings } from './router/debug';
import { DEFAULT_ROUTING_POLICY } from './router/policy';
import { QuotaLedger } from './router/quota';
import { ModelRegistry, SEEDED_REGISTRY_ENTRIES } from './router/registry';
import { ModelRouter } from './router/router';
import { CONFIG_KEYS, CONFIG_SECTION } from './shared/configuration';
import { redactSecrets } from './shared/redaction';

let output: vscode.OutputChannel | undefined;
let chatService: ChatService | undefined;
let workspaceTools: WorkspaceToolHost | undefined;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Seeker');
  const channel = output;
  context.subscriptions.push(channel);

  const log = (message: string): void => {
    channel.appendLine(redactSecrets(message));
  };

  try {
    const credentials = new SecretStorageCredentialProvider(context.secrets);
    const startupConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const enabledProviders = resolveEnabledProviders({
      configuredProviders: startupConfig.get<string[]>(CONFIG_KEYS.providersEnabled, [
        ...PROVIDER_IDS,
      ]),
      flags: {
        openrouter: startupConfig.get<boolean>(CONFIG_KEYS.openrouterEnabled, true),
        groq: startupConfig.get<boolean>(CONFIG_KEYS.groqEnabled, true),
      },
    });
    const adapters = createProviderAdapters(credentials, {}, enabledProviders);
    const catalog = new ModelCatalog(adapters);
    const registry = new ModelRegistry(
      SEEDED_REGISTRY_ENTRIES.filter((entry) => enabledProviders.includes(entry.provider)),
    );
    const quota = new QuotaLedger();
    const router = new ModelRouter({ registry, quota });

    const getRoutingSettings = () => {
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
      const userExcluded = config.get<string[]>(CONFIG_KEYS.routingExcludedProviders, []);
      return toRoutingSettings({
        policy: config.get<string>(CONFIG_KEYS.routingPolicy, DEFAULT_ROUTING_POLICY),
        allowPaid: config.get<boolean>(CONFIG_KEYS.routingAllowPaid, false),
        maxCostUsdPerTask: config.get<number>(CONFIG_KEYS.routingMaxCostUsdPerTask, 0),
        preferredProvider: config.get<string>(CONFIG_KEYS.routingPreferredProvider, ''),
        preferredModel: config.get<string>(CONFIG_KEYS.routingPreferredModel, ''),
        excludedProviders: [
          ...userExcluded,
          ...PROVIDER_IDS.filter((provider) => !enabledProviders.includes(provider)),
        ],
      });
    };

    const showSelection = (): string => {
      const settings = getRoutingSettings();

      for (const provider of enabledProviders) {
        const cached = catalog.getCached(provider);
        if (cached) {
          registry.applyProviderDiscovery(provider, cached);
        }
      }

      return formatRoutingDebug(registry, router.select(createDebugRequest(settings)), settings);
    };

    const ui: CommandUi = {
      showInformationMessage: (message) => vscode.window.showInformationMessage(message),
      showErrorMessage: (message) => vscode.window.showErrorMessage(message),
      showWarningMessage: (message, ...items) =>
        vscode.window.showWarningMessage(message, { modal: true }, ...items),
      showInputBox: (options) => vscode.window.showInputBox(options),
      showQuickPick: (items, options) => vscode.window.showQuickPick(items, options),
    };

    const disposables = registerSeekerCommands(
      {
        registerCommand: (command, callback) => vscode.commands.registerCommand(command, callback),
      },
      ui,
      { credentials, adapters, catalog, registry, quota, log, showSelection },
    );

    context.subscriptions.push(...disposables);

    workspaceTools = new WorkspaceToolHost({ context, mode: 'ask', output });

    chatService = new ChatService({
      adapters,
      catalog,
      registry,
      router,
      quota,
      credentials,
      getRoutingSettings,
      storage: {
        get<T>(key: string): T | undefined {
          return context.workspaceState.get<T>(key);
        },
        set<T>(key: string, value: T | undefined): void {
          void context.workspaceState.update(key, value);
        },
      },
      tools: workspaceTools,
    });

    const chatView = new ChatViewProvider(context.extensionUri, context.extension.id, chatService);
    context.subscriptions.push(
      chatView,
      vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, chatView, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${CONFIG_SECTION}.routing`)) {
          chatView.refreshState();
        }
      }),
    );

    const enabled = startupConfig.get<boolean>(CONFIG_KEYS.enabled, true);
    log(
      `Seeker activated (enabled=${enabled}, providers=${
        enabledProviders.join(',') || 'none'
      }, tools=${workspaceTools.registry.list().length}, trusted=${vscode.workspace.isTrusted}).`,
    );
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    log(`Seeker activation failed: ${message}`);
    throw error;
  }
}

export function deactivate(): void {
  chatService?.dispose();
  chatService = undefined;
  workspaceTools = undefined;
  output = undefined;
}
