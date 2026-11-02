import * as vscode from 'vscode';
import { registerSeekerCommands, type CommandUi } from './extension/commands';
import { SecretStorageCredentialProvider } from './extension/secrets';
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
    const configuredProviders = startupConfig.get<string[]>(CONFIG_KEYS.providersEnabled, [
      ...PROVIDER_IDS,
    ]);
    const enabledProviders = PROVIDER_IDS.filter((provider) => {
      if (!configuredProviders.includes(provider)) {
        return false;
      }
      const setting =
        provider === 'openrouter' ? CONFIG_KEYS.openrouterEnabled : CONFIG_KEYS.groqEnabled;
      return startupConfig.get<boolean>(setting, true);
    });
    const adapters = createProviderAdapters(credentials, {}, enabledProviders);
    const catalog = new ModelCatalog(adapters);
    const registry = new ModelRegistry(
      SEEDED_REGISTRY_ENTRIES.filter((entry) => enabledProviders.includes(entry.provider)),
    );
    const quota = new QuotaLedger();
    const router = new ModelRouter({ registry, quota });

    const showSelection = (): string => {
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
      const userExcluded = config.get<string[]>(CONFIG_KEYS.routingExcludedProviders, []);
      const settings = toRoutingSettings({
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

    const enabled = startupConfig.get<boolean>(CONFIG_KEYS.enabled, true);
    log(
      `Seeker activated (enabled=${enabled}, providers=${enabledProviders.join(',') || 'none'}).`,
    );
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    log(`Seeker activation failed: ${message}`);
    throw error;
  }
}

export function deactivate(): void {
  output = undefined;
}
