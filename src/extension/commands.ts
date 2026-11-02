import { ProviderRequestError } from '../providers/errors';
import type { ModelCatalog } from '../providers/model-catalog';
import type {
  CredentialProvider,
  KeyStatusProvider,
  ProviderAdapter,
  ProviderId,
  ProviderKeyStatus,
} from '../providers/types';
import type { QuotaLedger } from '../router/quota';
import type { ModelRegistry } from '../router/registry';
import { redactSecrets } from '../shared/redaction';
import { COMMANDS, type CommandId } from '../shared/commands';

export interface DisposableLike {
  dispose(): void;
}

export interface CommandRegistrar {
  registerCommand(command: string, callback: (...args: unknown[]) => unknown): DisposableLike;
}

export interface ProviderPickItem {
  label: string;
  description: string;
  provider: ProviderId;
}

export interface QuickPickOptions {
  title?: string;
  placeHolder?: string;
}

export interface InputBoxOptions {
  title?: string;
  prompt?: string;
  placeHolder?: string;
  password?: boolean;
  ignoreFocusOut?: boolean;
}

export interface CommandUi {
  showInformationMessage(message: string): unknown;
  showErrorMessage?(message: string): unknown;
  showWarningMessage?(message: string, ...items: string[]): Thenable<string | undefined>;
  showInputBox?(options: InputBoxOptions): Thenable<string | undefined>;
  showQuickPick?(
    items: readonly ProviderPickItem[],
    options?: QuickPickOptions,
  ): Thenable<ProviderPickItem | undefined>;
}

export interface CommandServices {
  credentials?: CredentialProvider;
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  catalog?: ModelCatalog;
  registry?: ModelRegistry;
  quota?: QuotaLedger;
  log?: (message: string) => void;
  showSelection?: () => string | Promise<string>;
}

export const HELLO_MESSAGE = 'Seeker is alive.';

export const PROVIDER_CHOICES: readonly ProviderPickItem[] = [
  {
    label: 'OpenRouter',
    description: 'Free model variants; 20 RPM and 50 requests/day without credits.',
    provider: 'openrouter',
  },
  {
    label: 'Groq',
    description: 'Fast free tier with daily request and token limits.',
    provider: 'groq',
  },
];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openrouter: 'OpenRouter',
  groq: 'Groq',
};

function isProviderId(value: unknown): value is ProviderId {
  return value === 'openrouter' || value === 'groq';
}

export function errorMessage(error: unknown): string {
  if (error instanceof ProviderRequestError) {
    return error.normalized.message;
  }
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }
  return redactSecrets(String(error));
}

async function pickProvider(ui: CommandUi, title: string): Promise<ProviderId | undefined> {
  if (!ui.showQuickPick) {
    ui.showInformationMessage('Provider selection is not available in this host.');
    return undefined;
  }

  const picked = await ui.showQuickPick(PROVIDER_CHOICES, {
    title,
    placeHolder: 'Choose a provider',
  });

  return picked?.provider;
}

function hasKeyStatus(adapter: ProviderAdapter): adapter is ProviderAdapter & KeyStatusProvider {
  return typeof (adapter as Partial<KeyStatusProvider>).getKeyStatus === 'function';
}

function formatKeyStatus(status: ProviderKeyStatus): string {
  const parts: string[] = [];
  const daily = status.freeModelDailyRequests;
  if (daily?.limit !== undefined) {
    const used = daily.used === undefined ? 'unknown' : String(daily.used);
    parts.push(`free daily requests ${used}/${daily.limit}`);
  }
  if (daily?.remaining !== undefined) {
    parts.push(`${daily.remaining} remaining`);
  }
  if (status.limitRemaining !== undefined) {
    parts.push(`credit limit remaining ${status.limitRemaining}`);
  }
  return parts.length > 0 ? ` ${parts.join('; ')}.` : '';
}

export function registerSeekerCommands(
  registrar: CommandRegistrar,
  ui: CommandUi,
  services: CommandServices = {},
): DisposableLike[] {
  const showError = (message: string): void => {
    if (ui.showErrorMessage) {
      ui.showErrorMessage(message);
    } else {
      ui.showInformationMessage(message);
    }
  };

  const setApiKey = async (providerArg?: unknown): Promise<void> => {
    const provider = isProviderId(providerArg)
      ? providerArg
      : await pickProvider(ui, 'Set API key');
    if (!provider) {
      return;
    }
    if (!services.credentials) {
      showError('Credential storage is unavailable.');
      return;
    }
    if (!ui.showInputBox) {
      showError('API key input is not available in this host.');
      return;
    }

    const label = PROVIDER_LABELS[provider];
    const key = await ui.showInputBox({
      title: `Set ${label} API key`,
      prompt: `Enter a ${label} API key. It is stored only in VS Code SecretStorage.`,
      placeHolder: 'API key',
      password: true,
      ignoreFocusOut: true,
    });

    if (key === undefined) {
      return;
    }
    if (!key.trim()) {
      showError('API key cannot be empty.');
      return;
    }

    await services.credentials.set(provider, key);
    services.log?.(`Saved API key for ${provider}.`);

    try {
      const models = services.catalog
        ? await services.catalog.refresh(provider)
        : await services.adapters?.[provider]?.listModels();
      if (models) {
        services.registry?.applyProviderDiscovery(provider, models);
      }
      ui.showInformationMessage(
        models
          ? `${label} API key saved. Discovered ${models.length} models.`
          : `${label} API key saved.`,
      );
    } catch (error) {
      ui.showInformationMessage(
        `${label} API key saved, but model discovery failed: ${errorMessage(error)}`,
      );
    }
  };

  const clearApiKey = async (providerArg?: unknown): Promise<void> => {
    const provider = isProviderId(providerArg)
      ? providerArg
      : await pickProvider(ui, 'Clear API key');
    if (!provider) {
      return;
    }
    if (!services.credentials) {
      showError('Credential storage is unavailable.');
      return;
    }

    const label = PROVIDER_LABELS[provider];
    if (!(await services.credentials.has(provider))) {
      ui.showInformationMessage(`No ${label} API key is stored.`);
      return;
    }

    if (ui.showWarningMessage) {
      const confirmed = await ui.showWarningMessage(`Clear the stored ${label} API key?`, 'Clear');
      if (confirmed !== 'Clear') {
        return;
      }
    }

    await services.credentials.delete(provider);
    services.catalog?.clear(provider);
    services.quota?.clear(provider);
    services.log?.(`Cleared API key for ${provider}.`);
    ui.showInformationMessage(`${label} API key cleared.`);
  };

  const refreshModels = async (providerArg?: unknown): Promise<void> => {
    const provider = isProviderId(providerArg)
      ? providerArg
      : await pickProvider(ui, 'Refresh models');
    if (!provider) {
      return;
    }
    if (!services.catalog) {
      showError('Model discovery is unavailable.');
      return;
    }

    const label = PROVIDER_LABELS[provider];
    const models = await services.catalog.refresh(provider);
    services.registry?.applyProviderDiscovery(provider, models);
    services.log?.(`Refreshed ${models.length} models for ${provider}.`);
    ui.showInformationMessage(`${label}: discovered ${models.length} models.`);
  };

  const showRouting = async (): Promise<void> => {
    if (!services.showSelection) {
      showError('Routing debug is unavailable.');
      return;
    }

    const text = await services.showSelection();
    services.log?.(text);
    ui.showInformationMessage(text);
  };

  const testConnection = async (providerArg?: unknown): Promise<void> => {
    const provider = isProviderId(providerArg)
      ? providerArg
      : await pickProvider(ui, 'Test connection');
    if (!provider) {
      return;
    }

    const adapter = services.adapters?.[provider];
    if (!adapter) {
      showError(`Provider "${provider}" is not configured.`);
      return;
    }

    const label = PROVIDER_LABELS[provider];
    const health = await adapter.healthCheck();
    services.log?.(
      `${label} health: ${health.state}${health.latencyMs === undefined ? '' : ` (${health.latencyMs} ms)`}.`,
    );

    if (health.state !== 'healthy') {
      const detail = health.message ?? 'No additional details.';
      showError(`${label} connection test failed: ${detail}`);
      return;
    }

    let statusSuffix = '';
    if (hasKeyStatus(adapter)) {
      try {
        const status = await adapter.getKeyStatus();
        services.quota?.reconcileProviderKeyStatus(provider, status);
        statusSuffix = formatKeyStatus(status);
      } catch (error) {
        showError(`${label} connected, but key status failed: ${errorMessage(error)}`);
        return;
      }
    }

    ui.showInformationMessage(
      `${label} connected${health.latencyMs === undefined ? '' : ` in ${health.latencyMs} ms`}.${statusSuffix}`,
    );
  };

  const handlers: Record<CommandId, (arg?: unknown) => void | Promise<void>> = {
    [COMMANDS.hello]: () => {
      ui.showInformationMessage(HELLO_MESSAGE);
    },
    [COMMANDS.setApiKey]: setApiKey,
    [COMMANDS.clearApiKey]: clearApiKey,
    [COMMANDS.refreshModels]: refreshModels,
    [COMMANDS.testConnection]: testConnection,
    [COMMANDS.showRouting]: showRouting,
  };

  return (Object.keys(handlers) as CommandId[]).map((command) =>
    registrar.registerCommand(command, async (arg?: unknown) => {
      try {
        await handlers[command](arg);
      } catch (error) {
        const message = errorMessage(error);
        services.log?.(`Command ${command} failed: ${message}`);
        showError(message);
      }
    }),
  );
}
