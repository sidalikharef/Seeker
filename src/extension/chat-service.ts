import type { AgentEvent } from '../core/events';
import { SessionManager } from '../core/session-manager';
import type { ModelCatalog } from '../providers/model-catalog';
import { AgentRunner, type AgentSelection } from './agent-runner';
import type { WorkspaceToolHost } from './workspace-host';
import { normalizeTransportError, ProviderRequestError } from '../providers/errors';
import {
  PROVIDER_IDS,
  type CredentialProvider,
  type ModelDescriptor,
  type FinishReason,
  type ModelEvent,
  type NormalizedMessage,
  type NormalizedProviderError,
  type ProviderAdapter,
  type ProviderId,
} from '../providers/types';
import { estimatedCostUsdPerMTok, isFreeClass } from '../router/classify';
import type { RoutingSettings } from '../router/debug';
import type { ModelRegistry, ModelRegistryEntry } from '../router/registry';
import type { ModelRouter, RoutingRequest } from '../router/router';
import type { QuotaLedger } from '../router/quota';
import { redactSecrets } from '../shared/redaction';
import type {
  AgentMode,
  ErrorAction,
  HostToWebview,
  MessageStatus,
  PublicDecision,
  PublicMessage,
  PublicModel,
  PublicProvider,
  PublicSelection,
  PublicUiState,
} from './webview/protocol';

const STORAGE_KEY_MESSAGES = 'seeker.chat.messages.v1';
const STORAGE_KEY_SELECTION = 'seeker.chat.selection.v1';
const STORAGE_KEY_MODE = 'seeker.chat.mode.v1';
const MAX_STORED_MESSAGES = 60;
const MAX_CONTEXT_MESSAGES = 40;
const MAX_CONTEXT_CHARS = 60_000;

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openrouter: 'OpenRouter',
  groq: 'Groq',
};

const SYSTEM_PROMPT =
  'You are SEEKER, an AI coding assistant inside Visual Studio Code. Be accurate and concise. ' +
  'State uncertainty clearly, never claim an action you did not take, and prefer practical code examples.';

export interface ChatStorage {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T | undefined): void;
}

export interface ChatServiceOptions {
  adapters: Partial<Record<ProviderId, ProviderAdapter>>;
  catalog: ModelCatalog;
  registry: ModelRegistry;
  router: ModelRouter;
  quota: QuotaLedger;
  credentials: CredentialProvider;
  getRoutingSettings: () => RoutingSettings;
  storage: ChatStorage;
  tools?: WorkspaceToolHost;
  now?: () => number;
  createId?: () => string;
}

export interface SendChatOptions {
  requestId: string;
  message: string;
  provider?: ProviderId;
  modelId?: string;
}

interface ActiveRequest {
  requestId: string;
  messageId: string;
  provider: ProviderId;
  modelId: string;
  controller: AbortController;
  cancelRequested: boolean;
}

interface LastAttempt {
  prompt: string;
  selection?: PublicSelection;
}

type Listener = (event: HostToWebview) => void;

function isMessageStatus(value: unknown): value is MessageStatus {
  return (
    value === 'complete' || value === 'streaming' || value === 'error' || value === 'cancelled'
  );
}

function restoreMessages(value: unknown): PublicMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is PublicMessage => {
      if (typeof item !== 'object' || item === null) return false;
      const message = item as Partial<PublicMessage>;
      return (
        typeof message.id === 'string' &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        typeof message.createdAt === 'string' &&
        isMessageStatus(message.status)
      );
    })
    .slice(-MAX_STORED_MESSAGES)
    .map((message) =>
      message.status === 'streaming'
        ? {
            ...message,
            status: 'cancelled',
            error: message.error ?? 'The previous response was interrupted.',
          }
        : message,
    );
}

function restoreMode(value: unknown): AgentMode {
  return value === 'plan' || value === 'review' || value === 'build' || value === 'debug'
    ? value
    : 'ask';
}

function restoreSelection(value: unknown): PublicSelection | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const selection = value as Partial<PublicSelection>;
  if (
    typeof selection.provider === 'string' &&
    (PROVIDER_IDS as readonly string[]).includes(selection.provider) &&
    typeof selection.modelId === 'string' &&
    selection.modelId.length > 0
  ) {
    return { provider: selection.provider as ProviderId, modelId: selection.modelId };
  }
  return undefined;
}

function safeErrorText(error: unknown): string {
  if (error instanceof ProviderRequestError) {
    return redactSecrets(error.normalized.message);
  }
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }
  return redactSecrets(String(error));
}

function normalizeError(
  error: unknown,
  provider: ProviderId,
  modelId: string,
): NormalizedProviderError {
  if (error instanceof ProviderRequestError) {
    return error.normalized;
  }
  return normalizeTransportError({ provider, model: modelId, error });
}

function capabilityLabels(entry: ModelRegistryEntry): string[] {
  const labels: string[] = [];
  if (entry.capabilities.supportsTools === true) labels.push('tools');
  if (entry.capabilities.supportsReasoning === true) labels.push('reasoning');
  if (entry.capabilities.supportsImages === true) labels.push('images');
  if ((entry.capabilities.contextWindow ?? 0) >= 128_000) labels.push('128K context');
  return labels;
}

function modelReason(
  entry: ModelRegistryEntry,
  providerConfigured: boolean,
  quota: QuotaLedger,
  settings: RoutingSettings,
): string | undefined {
  if (!providerConfigured) {
    return 'API key is not configured';
  }
  const check = quota.canUse(entry.provider, entry.modelId);
  if (!check.allowed) {
    return check.reason ?? 'model is unavailable';
  }
  if (!isFreeClass(entry.freeTierClass)) {
    if (!settings.allowPaid) {
      return `tier "${entry.freeTierClass}" is disabled because paid fallback is off`;
    }
    if (settings.maxCostUsd <= 0) {
      return 'paid model requires a non-zero max cost limit';
    }
    if (!entry.pricing) {
      return 'paid model pricing is unknown';
    }
    const estimated = estimatedCostUsdPerMTok(entry.pricing);
    if (estimated > settings.maxCostUsd) {
      return `estimated cost ${estimated.toFixed(2)} USD/MTok exceeds the configured limit`;
    }
  }
  if (entry.capabilities.supportsStreaming !== true) {
    return 'streaming is not declared for this model';
  }
  return undefined;
}

function actionsForError(error: NormalizedProviderError): ErrorAction[] {
  switch (error.kind) {
    case 'auth':
      return ['settings', 'retry'];
    case 'rate_limit':
    case 'quota_exhausted':
      return ['retry', 'refreshModels'];
    case 'model_not_found':
      return ['refreshModels'];
    case 'server':
    case 'network':
    case 'timeout':
      return ['retry'];
    case 'capability':
    case 'context_overflow':
    case 'bad_request':
      return [];
    default:
      return error.retryable ? ['retry'] : ['settings'];
  }
}

function isCancelled(error: NormalizedProviderError): boolean {
  return error.kind === 'cancelled';
}

export class ChatService {
  private readonly adapters: Partial<Record<ProviderId, ProviderAdapter>>;
  private readonly catalog: ModelCatalog;
  private readonly registry: ModelRegistry;
  private readonly router: ModelRouter;
  private readonly quota: QuotaLedger;
  private readonly credentials: CredentialProvider;
  private readonly getRoutingSettings: () => RoutingSettings;
  private readonly storage: ChatStorage;
  private readonly tools?: WorkspaceToolHost;
  private readonly agentRunner?: AgentRunner;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly listeners = new Set<Listener>();
  private readonly providerErrors = new Map<ProviderId, string>();
  private messages: PublicMessage[];
  private mode: AgentMode;
  private selected?: PublicSelection;
  private lastDecision?: PublicDecision;
  private lastAttempt?: LastAttempt;
  private active?: ActiveRequest;
  private status: 'idle' | 'streaming' | 'cancelling' = 'idle';
  private modelRefresh?: Promise<void>;
  private stateRevision = 0;
  private disposed = false;

  constructor(options: ChatServiceOptions) {
    this.adapters = options.adapters;
    this.catalog = options.catalog;
    this.registry = options.registry;
    this.router = options.router;
    this.quota = options.quota;
    this.credentials = options.credentials;
    this.getRoutingSettings = options.getRoutingSettings;
    this.storage = options.storage;
    this.tools = options.tools;
    this.now = options.now ?? Date.now;
    this.createId =
      options.createId ??
      (() => {
        const id = globalThis.crypto?.randomUUID?.();
        return id ?? `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      });
    this.messages = restoreMessages(this.storage.get<unknown>(STORAGE_KEY_MESSAGES));
    this.mode = restoreMode(this.storage.get<unknown>(STORAGE_KEY_MODE));
    this.selected = restoreSelection(this.storage.get<unknown>(STORAGE_KEY_SELECTION));
    this.agentRunner = options.tools
      ? new AgentRunner({
          adapters: this.adapters,
          router: this.router,
          quota: this.quota,
          getRoutingSettings: this.getRoutingSettings,
          tools: options.tools,
          sessions: new SessionManager({
            storage: this.storage,
            now: this.now,
            createId: this.createId,
          }),
          createId: this.createId,
        })
      : undefined;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: HostToWebview): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken webview must not break chat session handling.
      }
    }
  }

  private persist(): void {
    this.storage.set(STORAGE_KEY_MESSAGES, this.messages);
    this.storage.set(STORAGE_KEY_SELECTION, this.selected);
    this.storage.set(STORAGE_KEY_MODE, this.mode);
  }

  private emitState(): void {
    const revision = ++this.stateRevision;
    void this.getPublicState()
      .then((state) => {
        if (revision === this.stateRevision && !this.disposed) {
          this.emit({ type: 'state', state });
        }
      })
      .catch((error: unknown) => {
        this.emit({
          type: 'error',
          message: safeErrorText(error),
          recoverable: true,
          actions: ['settings'],
        });
      });
  }

  async getPublicState(): Promise<PublicUiState> {
    const settings = this.getRoutingSettings();
    const providers = await Promise.all(
      PROVIDER_IDS.map(async (provider): Promise<PublicProvider | undefined> => {
        const adapter = this.adapters[provider];
        if (!adapter) {
          return undefined;
        }
        const configured = await this.credentials.has(provider);
        const models = this.registry.list(provider).map((entry): PublicModel => {
          const reason = modelReason(entry, configured, this.quota, settings);
          return {
            id: entry.modelId,
            name: entry.displayName,
            freeTierClass: entry.freeTierClass,
            capabilities: capabilityLabels(entry),
            available: reason === undefined,
            reason,
          };
        });
        return {
          id: provider,
          label: PROVIDER_LABELS[provider],
          configured,
          freeTierClass: adapter.freeTierClass,
          models,
          error: this.providerErrors.get(provider),
        };
      }),
    );

    return {
      mode: this.mode,
      providers: providers.filter((provider): provider is PublicProvider => provider !== undefined),
      selected: this.selected,
      lastDecision: this.lastDecision,
      policy: settings.policy,
      allowPaid: settings.allowPaid,
      maxCostUsd: settings.maxCostUsd,
      preferredProvider: settings.preferredProvider,
      session: {
        messages: this.messages.map((message) => ({ ...message })),
        status: this.status,
        activeRequestId: this.active?.requestId,
      },
    };
  }

  notifyState(): void {
    this.emitState();
  }

  setMode(mode: AgentMode): void {
    if (this.mode === mode) {
      return;
    }
    if (this.active) {
      this.emit({
        type: 'error',
        message: 'Stop the active response before changing modes.',
        recoverable: true,
        actions: [],
      });
      this.emitState();
      return;
    }
    this.mode = mode;
    this.persist();
    this.emitState();
  }

  getMessages(): readonly PublicMessage[] {
    return this.messages.map((message) => ({ ...message }));
  }

  getSelection(): PublicSelection | undefined {
    return this.selected ? { ...this.selected } : undefined;
  }

  selectModel(provider: ProviderId, modelId: string): boolean {
    if (!this.adapters[provider] || !this.registry.get(provider, modelId)) {
      this.emit({
        type: 'error',
        message: `Model ${provider}/${modelId} is not available. Refresh the model list and try again.`,
        recoverable: true,
        actions: ['refreshModels', 'settings'],
      });
      this.emitState();
      return false;
    }
    this.selected = { provider, modelId };
    this.persist();
    this.emitState();
    return true;
  }

  clearSelection(): void {
    if (!this.selected) {
      return;
    }
    this.selected = undefined;
    this.persist();
    this.emitState();
  }

  async ensureModels(force = false): Promise<void> {
    if (this.modelRefresh) {
      return this.modelRefresh;
    }

    this.modelRefresh = this.refreshConfiguredModels(force).finally(() => {
      this.modelRefresh = undefined;
    });
    return this.modelRefresh;
  }

  private async refreshConfiguredModels(force: boolean): Promise<void> {
    let changed = false;
    let selectionChanged = false;
    for (const provider of PROVIDER_IDS) {
      const adapter = this.adapters[provider];
      if (!adapter || !(await this.credentials.has(provider))) {
        this.providerErrors.delete(provider);
        continue;
      }

      try {
        const models: ModelDescriptor[] = force
          ? await this.catalog.refresh(provider)
          : await this.catalog.get(provider);
        this.registry.applyProviderDiscovery(provider, models);
        this.providerErrors.delete(provider);
        changed = true;
      } catch (error) {
        this.providerErrors.set(provider, safeErrorText(error));
      }
    }

    if (this.selected) {
      const selected = this.selected;
      const stillAvailable =
        this.adapters[selected.provider] !== undefined &&
        (await this.credentials.has(selected.provider)) &&
        this.registry.get(selected.provider, selected.modelId) !== undefined;
      if (!stillAvailable) {
        this.selected = undefined;
        selectionChanged = true;
      }
    }

    if (selectionChanged) {
      this.persist();
    }
    if (changed || selectionChanged || this.providerErrors.size > 0) {
      this.emitState();
    }
  }

  async refreshModels(): Promise<void> {
    await this.ensureModels(true);
    if (this.providerErrors.size > 0) {
      const details = [...this.providerErrors.entries()]
        .map(([provider, message]) => `${PROVIDER_LABELS[provider]}: ${message}`)
        .join(' ');
      this.emit({
        type: 'error',
        message: `Could not refresh models. ${details}`,
        recoverable: true,
        actions: ['settings'],
      });
    }
  }

  async send(options: SendChatOptions): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.active) {
      this.emit({
        type: 'error',
        requestId: options.requestId,
        message: 'A response is already streaming. Stop it or wait for it to finish.',
        recoverable: true,
        actions: [],
      });
      return;
    }

    const prompt = options.message.trim();
    if (!prompt) {
      return;
    }
    if (prompt.length > 32 * 1024) {
      this.emit({
        type: 'error',
        requestId: options.requestId,
        message: 'The message is too long. Keep it under 32,000 characters.',
        recoverable: false,
        actions: [],
      });
      return;
    }

    if (options.provider || options.modelId) {
      if (
        !options.provider ||
        !options.modelId ||
        !this.selectModel(options.provider, options.modelId)
      ) {
        return;
      }
    }

    this.providerErrors.clear();
    this.lastDecision = undefined;
    this.persist();

    if (this.mode === 'build' || this.mode === 'debug') {
      await this.runAgent(options.requestId, prompt, false, this.selected);
      return;
    }

    await this.run(options.requestId, prompt, false, this.selected);
  }

  async retry(requestId: string): Promise<void> {
    if (this.disposed || this.active) {
      return;
    }

    let last = this.messages.at(-1);
    if (last?.role === 'assistant' && (last.status === 'error' || last.status === 'cancelled')) {
      this.messages.pop();
      last = this.messages.at(-1);
    }
    if (last?.role !== 'user' || !this.lastAttempt || this.lastAttempt.prompt !== last.content) {
      return;
    }

    if (this.mode === 'build' || this.mode === 'debug') {
      await this.runAgent(requestId, this.lastAttempt.prompt, true, this.lastAttempt.selection);
      return;
    }

    await this.run(requestId, this.lastAttempt.prompt, true, this.lastAttempt.selection);
  }

  cancel(requestId: string): void {
    if (!this.active || this.active.requestId !== requestId) {
      return;
    }
    this.active.cancelRequested = true;
    this.status = 'cancelling';
    this.active.controller.abort();
    this.emitState();
  }

  private buildRoutingRequest(
    settings: RoutingSettings,
    explicitSelection: PublicSelection | undefined,
    excludedProviders: ProviderId[],
  ): RoutingRequest {
    const taskKind: RoutingRequest['taskKind'] =
      this.mode === 'plan'
        ? 'plan'
        : this.mode === 'review'
          ? 'review'
          : this.mode === 'debug'
            ? 'debug'
            : this.mode === 'build'
              ? 'code'
              : 'chat';
    if (explicitSelection) {
      return {
        taskKind,
        required: { tools: false, streaming: true },
        policy: 'manual',
        allowPaid: settings.allowPaid,
        maxCostUsd: settings.maxCostUsd,
        preferredProvider: explicitSelection.provider,
        preferredModel: explicitSelection.modelId,
        excludeProviders: [...new Set([...settings.excludedProviders, ...excludedProviders])],
      };
    }

    return {
      taskKind,
      required: { tools: false, streaming: true },
      policy: settings.policy,
      allowPaid: settings.allowPaid,
      maxCostUsd: settings.maxCostUsd,
      preferredProvider: settings.preferredProvider,
      preferredModel: settings.preferredModel,
      excludeProviders: [...new Set([...settings.excludedProviders, ...excludedProviders])],
    };
  }

  private async configuredProviders(): Promise<ProviderId[]> {
    const configured: ProviderId[] = [];
    for (const provider of PROVIDER_IDS) {
      if (this.adapters[provider] && (await this.credentials.has(provider))) {
        configured.push(provider);
      }
    }
    return configured;
  }

  private buildProviderMessages(prompt: string): NormalizedMessage[] {
    const last = this.messages.at(-1);
    const history = this.messages
      .slice(0, last?.role === 'user' && last.content === prompt ? -1 : undefined)
      .filter(
        (message) =>
          message.role === 'user' ||
          (message.role === 'assistant' && message.status === 'complete' && message.content.trim()),
      );
    const selected: NormalizedMessage[] = [];
    let total = 0;

    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index];
      const content = message.content.slice(0, MAX_CONTEXT_CHARS);
      if (
        selected.length >= MAX_CONTEXT_MESSAGES ||
        (total + content.length > MAX_CONTEXT_CHARS && selected.length > 0)
      ) {
        break;
      }
      selected.unshift({ role: message.role, content });
      total += content.length;
    }

    return [
      { role: 'system', content: SYSTEM_PROMPT },
      ...selected,
      { role: 'user', content: prompt },
    ];
  }

  private createAssistantMessage(provider: ProviderId, modelId: string): PublicMessage {
    return {
      id: this.createId(),
      role: 'assistant',
      content: '',
      createdAt: new Date(this.now()).toISOString(),
      provider,
      modelId,
      status: 'streaming',
    };
  }

  private appendUserMessage(prompt: string): PublicMessage {
    const message: PublicMessage = {
      id: this.createId(),
      role: 'user',
      content: prompt,
      createdAt: new Date(this.now()).toISOString(),
      status: 'complete',
    };
    this.messages.push(message);
    return message;
  }

  private trimMessages(): void {
    while (this.messages.length > MAX_STORED_MESSAGES) {
      if (this.messages[0]?.status === 'streaming') {
        break;
      }
      this.messages.shift();
    }
  }

  private handleAgentEvent(
    event: AgentEvent,
    requestId: string,
    toolNames: Map<string, string>,
  ): void {
    switch (event.type) {
      case 'tool.requested':
        toolNames.set(event.call.id, event.call.name);
        this.emit({
          type: 'tool.activity',
          id: event.call.id,
          requestId,
          label: `Running ${event.call.name}`,
          status: 'running',
        });
        return;
      case 'tool.completed':
        this.emit({
          type: 'tool.activity',
          id: event.callId,
          requestId,
          label: `${toolNames.get(event.callId) ?? 'Tool'} ${event.ok ? 'completed' : 'failed'}`,
          status: event.ok ? 'ok' : 'error',
        });
        return;
      case 'verification.completed':
        this.emit({
          type: 'tool.activity',
          id: `verification-${event.sessionId}`,
          requestId,
          label: event.result.satisfied ? 'Verification passed' : 'Verification incomplete',
          status: event.result.satisfied ? 'ok' : 'error',
        });
        return;
      case 'quota.warning':
        this.emit({
          type: 'error',
          requestId,
          message: event.message,
          recoverable: true,
          actions: ['refreshModels', 'retry'],
        });
        return;
      default:
        return;
    }
  }

  private async runAgent(
    requestId: string,
    prompt: string,
    reuseUserMessage: boolean,
    explicitSelection: PublicSelection | undefined,
  ): Promise<void> {
    if (!this.agentRunner || !this.tools) {
      this.emit({
        type: 'error',
        requestId,
        message: 'Workspace tools are unavailable, so Build and Debug modes cannot run.',
        recoverable: true,
        actions: [],
      });
      return;
    }

    const configured = await this.configuredProviders();
    if (configured.length === 0) {
      this.emit({
        type: 'error',
        requestId,
        message: 'No provider is configured. Add a free OpenRouter or Groq API key first.',
        recoverable: true,
        actions: ['settings'],
      });
      return;
    }

    if (explicitSelection && !configured.includes(explicitSelection.provider)) {
      this.emit({
        type: 'error',
        requestId,
        message: `${PROVIDER_LABELS[explicitSelection.provider]} is not configured. Add an API key in settings.`,
        recoverable: true,
        actions: ['settings'],
      });
      return;
    }

    const selection: AgentSelection | undefined = this.agentRunner.select(
      this.mode,
      explicitSelection,
      configured,
    );
    if (!selection) {
      this.emit({
        type: 'error',
        requestId,
        message: 'No eligible model supports tool calling and streaming for this mode.',
        recoverable: true,
        actions: ['refreshModels', 'settings'],
      });
      this.persist();
      return;
    }

    if (!this.adapters[selection.provider]) {
      this.emit({
        type: 'error',
        requestId,
        message: `Provider ${selection.provider} is not configured.`,
        recoverable: true,
        actions: ['settings'],
      });
      return;
    }

    if (!reuseUserMessage) {
      this.appendUserMessage(prompt);
    }

    const assistant = this.createAssistantMessage(selection.provider, selection.modelId);
    this.messages.push(assistant);
    this.trimMessages();
    this.lastDecision = {
      provider: selection.provider,
      modelId: selection.modelId,
      reason: selection.reason,
      automatic: explicitSelection === undefined,
    };
    this.lastAttempt = { prompt, selection: explicitSelection };
    this.status = 'streaming';
    this.persist();

    const active: ActiveRequest = {
      requestId,
      messageId: assistant.id,
      provider: selection.provider,
      modelId: selection.modelId,
      controller: new AbortController(),
      cancelRequested: false,
    };
    this.active = active;

    this.emitState();
    this.emit({
      type: 'assistant.start',
      requestId,
      messageId: assistant.id,
      provider: selection.provider,
      modelId: selection.modelId,
    });

    const toolNames = new Map<string, string>();
    const finish = (messageStatus: MessageStatus, content: string, errorMessage?: string): void => {
      this.status = 'idle';
      this.active = undefined;
      assistant.status = messageStatus;
      assistant.content = content;
      assistant.error = errorMessage;
      this.persist();
      this.emit({
        type: 'assistant.end',
        requestId,
        messageId: assistant.id,
        status: messageStatus,
        content,
        error: errorMessage,
      });
      if (messageStatus === 'error' && errorMessage) {
        this.emit({
          type: 'error',
          requestId,
          message: `${PROVIDER_LABELS[selection.provider]}: ${errorMessage}`,
          recoverable: true,
          actions: ['retry', 'settings'],
        });
      }
      this.emitState();
    };

    try {
      const result = await this.agentRunner.run({
        requestId,
        prompt,
        mode: this.mode,
        selection,
        explicitSelection,
        availableProviders: configured,
        signal: active.controller.signal,
        onEvent: (event) => this.handleAgentEvent(event, requestId, toolNames),
        onDelta: (text) => {
          if (!active.cancelRequested) {
            this.emit({ type: 'assistant.delta', requestId, messageId: assistant.id, text });
          }
        },
      });

      const session = result.session;
      const cancelled = active.cancelRequested || session.status === 'cancelled';
      if (cancelled) {
        finish('cancelled', result.content, 'Response cancelled.');
        return;
      }

      if (session.status === 'failed' || session.status === 'paused_quota') {
        const message = session.error?.message ?? 'The agent task failed.';
        if (session.status === 'paused_quota') {
          this.quota.recordError(
            selection.provider,
            {
              provider: selection.provider,
              model: selection.modelId,
              kind: 'quota_exhausted',
              message,
              retryable: true,
            },
            { modelId: selection.modelId },
          );
        } else {
          this.quota.recordError(
            selection.provider,
            normalizeTransportError({
              provider: selection.provider,
              model: selection.modelId,
              error: new Error(message),
            }),
            { modelId: selection.modelId },
          );
        }
        finish('error', result.content, message);
        return;
      }

      this.quota.recordSuccess(selection.provider, selection.modelId);
      let content = result.content;
      if (session.status === 'completed_unverified') {
        content = `${content}${content ? '\n\n' : ''}_Completed without verification evidence._`;
      }
      finish('complete', content);
    } catch (error) {
      const message = safeErrorText(error);
      if (!active.cancelRequested) {
        this.quota.recordError(
          selection.provider,
          normalizeTransportError({
            provider: selection.provider,
            model: selection.modelId,
            error,
          }),
          { modelId: selection.modelId },
        );
      }
      finish(active.cancelRequested ? 'cancelled' : 'error', '', message);
    }
  }

  private async run(
    requestId: string,
    prompt: string,
    reuseUserMessage: boolean,
    explicitSelection: PublicSelection | undefined,
  ): Promise<void> {
    const configured = await this.configuredProviders();
    if (configured.length === 0) {
      this.emit({
        type: 'error',
        requestId,
        message: 'No provider is configured. Add a free OpenRouter or Groq API key first.',
        recoverable: true,
        actions: ['settings'],
      });
      return;
    }

    if (explicitSelection && !configured.includes(explicitSelection.provider)) {
      this.emit({
        type: 'error',
        requestId,
        message: `${PROVIDER_LABELS[explicitSelection.provider]} is not configured. Add an API key in settings.`,
        recoverable: true,
        actions: ['settings'],
      });
      return;
    }

    if (!reuseUserMessage) {
      this.appendUserMessage(prompt);
    }

    const settings = this.getRoutingSettings();
    const excluded = PROVIDER_IDS.filter((provider) => !configured.includes(provider));
    const result = this.router.select(
      this.buildRoutingRequest(settings, explicitSelection, excluded),
    );
    if (!result.decision) {
      const reason = result.rejected[0]?.reason ?? 'No streaming model is available.';
      this.emit({
        type: 'error',
        requestId,
        message: `No eligible model: ${reason}`,
        recoverable: true,
        actions: ['refreshModels', 'settings'],
      });
      this.persist();
      return;
    }

    const decision = result.decision;
    const adapter = this.adapters[decision.provider];
    if (!adapter) {
      this.emit({
        type: 'error',
        requestId,
        message: `Provider ${decision.provider} is not configured.`,
        recoverable: true,
        actions: ['settings'],
      });
      return;
    }

    const assistant = this.createAssistantMessage(decision.provider, decision.modelId);
    this.messages.push(assistant);
    this.trimMessages();
    this.lastDecision = {
      provider: decision.provider,
      modelId: decision.modelId,
      reason: decision.reason,
      automatic: explicitSelection === undefined,
    };
    this.lastAttempt = { prompt, selection: explicitSelection };
    this.status = 'streaming';
    this.persist();

    const active: ActiveRequest = {
      requestId,
      messageId: assistant.id,
      provider: decision.provider,
      modelId: decision.modelId,
      controller: new AbortController(),
      cancelRequested: false,
    };
    this.active = active;

    this.emitState();
    this.emit({
      type: 'assistant.start',
      requestId,
      messageId: assistant.id,
      provider: decision.provider,
      modelId: decision.modelId,
    });

    const messages = this.buildProviderMessages(prompt);
    let content = '';
    let failure: NormalizedProviderError | undefined;
    let finishReason: FinishReason | undefined;
    let toolCallSeen = false;
    let quotaLimited = false;

    try {
      for await (const event of adapter.streamChat(
        {
          model: decision.modelId,
          messages,
          temperature: 0.2,
        },
        active.controller.signal,
      )) {
        if (active.cancelRequested) {
          break;
        }
        await this.handleModelEvent(event, active, (text) => {
          content += text;
          this.emit({ type: 'assistant.delta', requestId, messageId: assistant.id, text });
        });
        if (event.type === 'error') {
          failure = event.error;
          break;
        }
        if (event.type === 'finish') {
          finishReason = event.reason;
          break;
        }
        if (event.type === 'tool-call-delta') {
          toolCallSeen = true;
        }
        if (event.type === 'rate-limit') {
          quotaLimited =
            event.metadata.requests?.remaining === 0 || event.metadata.tokens?.remaining === 0;
        }
      }
    } catch (error) {
      failure = normalizeError(error, decision.provider, decision.modelId);
    }

    if (active.cancelRequested || (failure && isCancelled(failure))) {
      failure = undefined;
      finishReason = 'cancelled';
    }

    if (!failure && finishReason !== 'cancelled') {
      if (toolCallSeen || finishReason === 'tool_calls') {
        failure = normalizeTransportError({
          provider: decision.provider,
          model: decision.modelId,
          error: new Error('The model requested tools, but workspace tools are not available yet.'),
        });
        failure.kind = 'capability';
        failure.retryable = false;
      } else if (finishReason === 'content_filter') {
        failure = normalizeTransportError({
          provider: decision.provider,
          model: decision.modelId,
          error: new Error('The provider blocked the response with a content filter.'),
        });
        failure.kind = 'bad_request';
        failure.retryable = false;
      } else if (!content.trim()) {
        failure = normalizeTransportError({
          provider: decision.provider,
          model: decision.modelId,
          error: new Error('The provider returned an empty response.'),
        });
      }
    }

    if (failure) {
      if (failure.kind === 'auth' || failure.kind === 'quota_exhausted') {
        this.quota.recordError(decision.provider, { ...failure, model: undefined });
      } else {
        this.quota.recordError(decision.provider, failure, { modelId: decision.modelId });
      }
      this.status = 'idle';
      this.active = undefined;
      assistant.status = finishReason === 'cancelled' ? 'cancelled' : 'error';
      assistant.content = content;
      assistant.error = failure.message;
      this.persist();
      this.emit({
        type: 'assistant.end',
        requestId,
        messageId: assistant.id,
        status: assistant.status,
        content,
        error: failure.message,
      });
      if (assistant.status === 'error') {
        this.emit({
          type: 'error',
          requestId,
          message: `${PROVIDER_LABELS[decision.provider]}: ${failure.message}`,
          recoverable: true,
          actions: actionsForError(failure),
        });
      }
      this.emitState();
      return;
    }

    if (!quotaLimited) {
      this.quota.recordSuccess(decision.provider, decision.modelId);
    }
    this.status = 'idle';
    this.active = undefined;
    assistant.status = finishReason === 'cancelled' ? 'cancelled' : 'complete';
    assistant.content = content;
    if (assistant.status === 'cancelled') {
      assistant.error = 'Response cancelled.';
    }
    this.persist();
    this.emit({
      type: 'assistant.end',
      requestId,
      messageId: assistant.id,
      status: assistant.status,
      content,
      error: assistant.error,
    });
    this.emitState();
  }

  private async handleModelEvent(
    event: ModelEvent,
    active: ActiveRequest,
    onText: (text: string) => void,
  ): Promise<void> {
    switch (event.type) {
      case 'text-delta':
        onText(event.text);
        return;
      case 'rate-limit':
        this.quota.applyRateLimitMetadata(active.provider, event.metadata, {
          modelId: active.modelId,
        });
        return;
      case 'usage':
      case 'tool-call-delta':
      case 'finish':
      case 'error':
        return;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.active?.controller.abort();
    this.active = undefined;
    this.listeners.clear();
  }
}
