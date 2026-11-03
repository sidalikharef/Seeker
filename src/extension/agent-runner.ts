import {
  AgentLoop,
  type AgentModelClient,
  type AgentModelResult,
  type AgentToolDescriptor,
  type AgentToolExecutor,
} from '../core/agent-loop';
import { AgentError } from '../core/errors';
import type { AgentEvent, AgentEventSink } from '../core/events';
import type { SessionManager } from '../core/session-manager';
import { createSession, type AgentMode, type AgentSession } from '../core/state';
import { DefaultVerificationEngine } from '../core/verification';
import {
  PROVIDER_IDS,
  type ModelEvent,
  type NormalizedMessage,
  type ProviderAdapter,
  type ToolCall,
  type ToolSchema,
  type Usage,
} from '../providers/types';
import type { ModelRouter, RoutingDecision, RoutingRequest } from '../router/router';
import type { QuotaLedger } from '../router/quota';
import type { RoutingSettings } from '../router/debug';
import { redactSecrets } from '../shared/redaction';
import type { ToolError } from '../tools/types';
import type { WorkspaceToolHost } from './workspace-host';

export interface AgentSelection {
  provider: RoutingDecision['provider'];
  modelId: string;
  reason: string;
}

export interface AgentRunnerOptions {
  adapters: Partial<Record<RoutingDecision['provider'], ProviderAdapter>>;
  router: ModelRouter;
  quota: QuotaLedger;
  getRoutingSettings: () => RoutingSettings;
  tools: WorkspaceToolHost;
  sessions?: SessionManager;
  createId?: () => string;
}

export interface AgentRunOptions {
  requestId: string;
  prompt: string;
  mode: AgentMode;
  selection: AgentSelection;
  explicitSelection?: { provider: AgentSelection['provider']; modelId: string };
  availableProviders: RoutingDecision['provider'][];
  signal: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  onDelta?: (text: string) => void;
}

export interface AgentRunResult {
  session: AgentSession;
  content: string;
  selection: AgentSelection;
}

function providerToolName(toolId: string): string {
  const safe = toolId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
  return safe.length > 0 ? safe : 'tool';
}

function providerMessages(messages: NormalizedMessage[]): NormalizedMessage[] {
  return messages.map((message) => ({
    ...message,
    ...(message.toolCalls
      ? {
          toolCalls: message.toolCalls.map((call) => ({
            ...call,
            name: providerToolName(call.name),
          })),
        }
      : {}),
  }));
}

function finalAssistantText(session: AgentSession): string {
  for (let index = session.conversation.length - 1; index >= 0; index -= 1) {
    const turn = session.conversation[index];
    if (turn?.role === 'assistant' && turn.content.trim()) {
      return turn.content;
    }
  }
  return '';
}

class WorkspaceAgentToolExecutor implements AgentToolExecutor {
  constructor(
    private readonly host: WorkspaceToolHost,
    private readonly mode: AgentMode,
  ) {}

  listTools(): AgentToolDescriptor[] {
    return this.host.registry.listForMode(this.mode).map((tool) => ({
      name: tool.id,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
      idempotent: tool.idempotent,
    }));
  }

  async execute(
    call: ToolCall,
    input: unknown,
    options: { session: AgentSession; signal: AbortSignal },
  ): Promise<{
    ok: boolean;
    data?: unknown;
    error?: ToolError;
  }> {
    const result = await this.host.execute(call.name, input, {
      signal: options.signal,
      sessionId: options.session.id,
      mode: this.mode,
    });
    if (result.ok) {
      return { ok: true, data: result.data };
    }
    return { ok: false, error: result.error };
  }
}

export class AgentRunner {
  private readonly adapters: AgentRunnerOptions['adapters'];
  private readonly router: ModelRouter;
  private readonly quota: QuotaLedger;
  private readonly getRoutingSettings: () => RoutingSettings;
  private readonly tools: WorkspaceToolHost;
  private readonly sessions?: SessionManager;
  private readonly createId: () => string;

  constructor(options: AgentRunnerOptions) {
    this.adapters = options.adapters;
    this.router = options.router;
    this.quota = options.quota;
    this.getRoutingSettings = options.getRoutingSettings;
    this.tools = options.tools;
    this.sessions = options.sessions;
    this.createId =
      options.createId ??
      (() =>
        globalThis.crypto?.randomUUID?.() ??
        `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  select(
    mode: AgentMode,
    explicitSelection: { provider: AgentSelection['provider']; modelId: string } | undefined,
    availableProviders: AgentSelection['provider'][],
  ): AgentSelection | undefined {
    const settings = this.getRoutingSettings();
    const request: RoutingRequest = explicitSelection
      ? {
          taskKind: mode === 'debug' ? 'debug' : 'code',
          required: { tools: true, streaming: true },
          policy: 'manual',
          allowPaid: settings.allowPaid,
          maxCostUsd: settings.maxCostUsd,
          preferredProvider: explicitSelection.provider,
          preferredModel: explicitSelection.modelId,
          excludeProviders: settings.excludedProviders,
        }
      : {
          taskKind: mode === 'debug' ? 'debug' : 'code',
          required: { tools: true, streaming: true },
          policy: settings.policy,
          allowPaid: settings.allowPaid,
          maxCostUsd: settings.maxCostUsd,
          preferredProvider: settings.preferredProvider,
          preferredModel: settings.preferredModel,
          excludeProviders: [
            ...new Set([
              ...settings.excludedProviders,
              ...PROVIDER_IDS.filter((provider) => !availableProviders.includes(provider)),
            ]),
          ],
        };

    const result = this.router.select(request);
    if (!result.decision) {
      return undefined;
    }
    return {
      provider: result.decision.provider,
      modelId: result.decision.modelId,
      reason: result.decision.reason,
    };
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    this.assertToolNames(options.mode);

    const configured = new Set(options.availableProviders);
    if (!configured.has(options.selection.provider)) {
      throw new AgentError('The selected provider is not configured.', 'auth', {
        code: 'provider_not_configured',
      });
    }
    const adapter = this.adapters[options.selection.provider];
    if (!adapter) {
      throw new AgentError('The selected provider adapter is unavailable.', 'fatal', {
        code: 'provider_unavailable',
      });
    }

    const session =
      this.sessions?.create({
        id: this.createId(),
        prompt: options.prompt,
        mode: options.mode,
        workspaceRoots: this.tools.workspaceRoots,
        policy: this.getRoutingSettings().policy,
        allowPaid: this.getRoutingSettings().allowPaid,
        maxCostUsd: this.getRoutingSettings().maxCostUsd,
      }) ??
      createSession({
        id: this.createId(),
        prompt: options.prompt,
        mode: options.mode,
        workspaceRoots: this.tools.workspaceRoots,
        policy: this.getRoutingSettings().policy,
        allowPaid: this.getRoutingSettings().allowPaid,
        maxCostUsd: this.getRoutingSettings().maxCostUsd,
      });

    session.routing.selected = options.selection;
    const contentParts: string[] = [];
    const sink: AgentEventSink = {
      emit: (event) => {
        this.sessions?.appendEvent(session.id, event);
        try {
          options.onEvent?.(event);
        } catch {
          // UI failures must not break the agent.
        }
      },
    };

    const model = this.createModelClient(options, adapter, (text) => {
      contentParts.push(text);
      try {
        options.onDelta?.(text);
      } catch {
        // UI failures must not break the agent.
      }
    });
    const loop = new AgentLoop({
      session,
      model,
      tools: new WorkspaceAgentToolExecutor(this.tools, options.mode),
      verification: new DefaultVerificationEngine(),
      events: sink,
      signal: options.signal,
    });

    try {
      const result = await loop.run();
      this.persist(result);
      return {
        session: result,
        content: contentParts.join('') || finalAssistantText(result),
        selection: options.selection,
      };
    } catch (error) {
      session.status = options.signal.aborted ? 'cancelled' : 'failed';
      session.error = {
        code: options.signal.aborted ? 'cancelled' : 'agent_error',
        message: redactSecrets(error instanceof Error ? error.message : String(error)),
        retryable: false,
      };
      this.persist(session);
      throw error;
    }
  }

  private persist(session: AgentSession): void {
    try {
      this.sessions?.save(session);
    } catch {
      // Session persistence is best-effort; never hide the agent result.
    }
  }

  private createModelClient(
    options: AgentRunOptions,
    adapter: ProviderAdapter,
    onText: (text: string) => void,
  ): AgentModelClient {
    const names = new Map<string, string>();
    const toolIds = new Map<string, string>();
    for (const descriptor of this.toolDescriptors(options.mode)) {
      const providerName = providerToolName(descriptor.name);
      names.set(descriptor.name, providerName);
      toolIds.set(providerName, descriptor.name);
    }

    return {
      run: async (messages, tools: ToolSchema[], signal): Promise<AgentModelResult> => {
        const providerTools: ToolSchema[] = tools.map((tool) => ({
          ...tool,
          name: names.get(tool.name) ?? providerToolName(tool.name),
        }));
        const callParts = new Map<number, { id?: string; name?: string; argumentsJson: string }>();
        let text = '';
        let finishReason: AgentModelResult['finishReason'] = 'unknown';
        let usage: Usage | undefined;
        let error: AgentModelResult['error'];

        try {
          for await (const event of adapter.streamChat(
            {
              model: options.selection.modelId,
              messages: providerMessages(messages),
              tools: providerTools.length > 0 ? providerTools : undefined,
              toolChoice: providerTools.length > 0 ? 'auto' : 'none',
              temperature: 0.2,
            },
            signal,
          )) {
            await this.handleModelEvent(event, {
              onText: (delta) => {
                text += delta;
                onText(delta);
              },
              onToolDelta: (delta) => {
                const current = callParts.get(delta.index) ?? { argumentsJson: '' };
                if (delta.id) current.id = delta.id;
                if (delta.name) current.name = delta.name;
                current.argumentsJson += delta.argumentsDelta ?? '';
                callParts.set(delta.index, current);
              },
              onUsage: (next) => {
                usage = next;
              },
              onFinish: (reason) => {
                finishReason = reason;
              },
              onError: (next) => {
                error = next;
              },
              onRateLimit: (metadata) => {
                this.quota.applyRateLimitMetadata(options.selection.provider, metadata, {
                  modelId: options.selection.modelId,
                });
              },
            });
          }
        } catch (cause) {
          error = {
            provider: options.selection.provider,
            model: options.selection.modelId,
            kind: signal.aborted ? 'cancelled' : 'network',
            message: redactSecrets(cause instanceof Error ? cause.message : String(cause)),
            retryable: !signal.aborted,
          };
        }

        const toolCalls: ToolCall[] = [...callParts.entries()]
          .sort(([left], [right]) => left - right)
          .map(([index, part]) => ({
            id: part.id ?? `${options.requestId}-tool-${index}`,
            name: toolIds.get(part.name ?? '') ?? part.name ?? 'unknown_tool',
            argumentsJson: part.argumentsJson || '{}',
          }));

        return {
          text,
          toolCalls,
          finishReason,
          ...(usage ? { usage } : {}),
          ...(error ? { error } : {}),
          selection: options.selection,
        };
      },
    };
  }

  private assertToolNames(mode: AgentMode): void {
    const seen = new Map<string, string>();
    for (const descriptor of this.toolDescriptors(mode)) {
      const providerName = providerToolName(descriptor.name);
      const existing = seen.get(providerName);
      if (existing && existing !== descriptor.name) {
        throw new AgentError(
          `Tool names ${existing} and ${descriptor.name} collide after provider-safe normalization.`,
          'fatal',
          { code: 'tool_name_collision' },
        );
      }
      seen.set(providerName, descriptor.name);
    }
  }

  private toolDescriptors(mode: AgentMode): AgentToolDescriptor[] {
    return this.tools.registry.listForMode(mode).map((tool) => ({
      name: tool.id,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
      idempotent: tool.idempotent,
    }));
  }

  private async handleModelEvent(
    event: ModelEvent,
    handlers: {
      onText: (text: string) => void;
      onToolDelta: (delta: {
        index: number;
        id?: string;
        name?: string;
        argumentsDelta?: string;
      }) => void;
      onUsage: (usage: Usage) => void;
      onFinish: (reason: AgentModelResult['finishReason']) => void;
      onError: (error: NonNullable<AgentModelResult['error']>) => void;
      onRateLimit: (metadata: Extract<ModelEvent, { type: 'rate-limit' }>['metadata']) => void;
    },
  ): Promise<void> {
    switch (event.type) {
      case 'text-delta':
        handlers.onText(event.text);
        return;
      case 'tool-call-delta':
        handlers.onToolDelta(event);
        return;
      case 'usage':
        handlers.onUsage(event.usage);
        return;
      case 'finish':
        handlers.onFinish(event.reason);
        return;
      case 'error':
        handlers.onError(event.error);
        return;
      case 'rate-limit':
        handlers.onRateLimit(event.metadata);
        return;
    }
  }
}
