import type {
  FinishReason,
  NormalizedMessage,
  NormalizedProviderError,
  ProviderId,
  ToolCall,
  ToolSchema,
} from '../providers/types';
import { stableStringify } from '../shared/hash';
import type { ToolError } from '../tools/types';
import { buildContextPackage } from '../context/package';
import {
  AgentError,
  agentErrorInfo,
  classifyProviderError,
  retryDelayMs,
  type AgentErrorInfo,
} from './errors';
import type { AgentEvent, AgentEventSink } from './events';
import type { ActionRecord, AgentSession, ToolObservation, VerificationResult } from './state';
import type { VerificationEngine } from './verification';

export interface AgentModelResult {
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  error?: NormalizedProviderError;
  selection?: { provider: ProviderId; modelId: string; reason: string };
}

export interface AgentModelClient {
  run(
    messages: NormalizedMessage[],
    tools: ToolSchema[],
    signal: AbortSignal,
  ): Promise<AgentModelResult>;
}

export interface AgentToolDescriptor {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  idempotent: boolean;
}

export interface AgentToolExecutionResult {
  ok: boolean;
  data?: unknown;
  error?: ToolError;
  durationMs?: number;
  cached?: boolean;
}

export interface AgentToolExecutor {
  listTools(): AgentToolDescriptor[];
  execute(
    call: ToolCall,
    input: unknown,
    options: { session: AgentSession; signal: AbortSignal },
  ): Promise<AgentToolExecutionResult>;
}

export interface AgentLoopOptions {
  session: AgentSession;
  model: AgentModelClient;
  tools: AgentToolExecutor;
  verification: VerificationEngine;
  events: AgentEventSink;
  signal: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function parseArguments(json: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(json) };
  } catch {
    return { ok: false };
  }
}

function toolSchema(descriptor: AgentToolDescriptor): ToolSchema {
  return {
    name: descriptor.name,
    description: descriptor.description,
    parameters: descriptor.parameters,
  };
}

function statusForError(error: AgentErrorInfo): AgentSession['status'] {
  if (error.class === 'cancelled') return 'cancelled';
  if (error.class === 'quota') return 'paused_quota';
  return 'failed';
}

export class AgentLoop {
  private readonly session: AgentSession;
  private readonly model: AgentModelClient;
  private readonly tools: AgentToolExecutor;
  private readonly verification: VerificationEngine;
  private readonly events: AgentEventSink;
  private readonly signal: AbortSignal;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(options: AgentLoopOptions) {
    this.session = options.session;
    this.model = options.model;
    this.tools = options.tools;
    this.verification = options.verification;
    this.events = options.events;
    this.signal = options.signal;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async run(): Promise<AgentSession> {
    const session = this.session;
    const startedAt = this.now();
    this.emit({ type: 'agent.started', sessionId: session.id, at: this.timestamp() });
    this.emit({
      type: 'agent.mode',
      sessionId: session.id,
      mode: session.mode,
      at: this.timestamp(),
    });

    let iteration = 0;
    try {
      while (iteration < session.budget.maxIterations) {
        iteration += 1;
        if (this.signal.aborted) {
          return this.cancel();
        }
        if (this.now() - startedAt > session.budget.maxWallClockMs) {
          return this.fail(
            new AgentError('The task exceeded its wall-clock budget.', 'fatal', {
              code: 'wall_clock_budget',
            }),
          );
        }
        if (session.usage.modelRequests >= session.budget.maxModelRequests) {
          return this.fail(
            new AgentError('The task exceeded its model-request budget.', 'fatal', {
              code: 'model_budget',
            }),
          );
        }

        this.transition('awaiting_model');
        const turn = await this.requestModel();
        if (!turn) {
          return session;
        }

        if (turn.selection) {
          session.routing.selected = turn.selection;
          this.emit({
            type: 'model.selected',
            sessionId: session.id,
            provider: turn.selection.provider,
            modelId: turn.selection.modelId,
            reason: turn.selection.reason,
            at: this.timestamp(),
          });
        }

        if (turn.error) {
          const error = classifyProviderError(turn.error);
          if (error.agentClass === 'cancelled') {
            return this.cancel();
          }
          return this.fail(error);
        }

        if (turn.text) {
          this.emit({
            type: 'assistant.delta',
            sessionId: session.id,
            text: turn.text,
            at: this.timestamp(),
          });
        }

        if (turn.toolCalls.length > 0) {
          this.addAssistantTurn(turn.text, turn.toolCalls);
          const calls = turn.toolCalls.slice(0, session.budget.maxToolCallsPerTurn);
          const skipped = turn.toolCalls.slice(session.budget.maxToolCallsPerTurn);
          this.transition('awaiting_tool');

          for (const call of calls) {
            if (this.signal.aborted) {
              return this.cancel();
            }
            if (session.usage.toolCalls >= session.budget.maxToolCalls) {
              return this.fail(
                new AgentError('The task exceeded its tool-call budget.', 'fatal', {
                  code: 'tool_budget',
                }),
              );
            }
            await this.runTool(call);
          }

          if (skipped.length > 0) {
            this.addToolTurn(
              skipped[0]?.id ?? 'tool-limit',
              'tool-limit',
              JSON.stringify({
                error: 'tool_call_limit',
                message: `The model requested more than ${session.budget.maxToolCallsPerTurn} tool calls in one turn; ${skipped.length} were ignored.`,
              }),
            );
          }
          continue;
        }

        this.addAssistantTurn(turn.text);
        this.transition('verifying');
        const verification = await this.verify();
        if (verification.satisfied) {
          this.transition('completed');
          this.emit({
            type: 'agent.completed',
            sessionId: session.id,
            verified: true,
            at: this.timestamp(),
          });
          return session;
        }

        if (session.task.acceptanceCriteria.length === 0) {
          this.transition('completed_unverified');
          this.emit({
            type: 'agent.completed',
            sessionId: session.id,
            verified: false,
            at: this.timestamp(),
          });
          return session;
        }

        const feedback = verification.criteria
          .filter((criterion) => !criterion.passed)
          .map((criterion) => `${criterion.id}: ${criterion.error ?? 'not satisfied'}`)
          .join('; ');
        this.addSystemTurn(`Verification is not satisfied. ${feedback}`);
      }

      return this.fail(
        new AgentError('The task exceeded its iteration budget.', 'fatal', {
          code: 'iteration_budget',
        }),
      );
    } catch (error) {
      if (this.signal.aborted) {
        return this.cancel();
      }
      return this.fail(error);
    }
  }

  private async requestModel(): Promise<AgentModelResult | undefined> {
    const session = this.session;
    const context = buildContextPackage({
      session,
      tools: this.tools.listTools().map(toolSchema),
    });

    for (let attempt = 0; attempt <= session.budget.maxProviderRetries; attempt += 1) {
      if (this.signal.aborted) {
        this.cancel();
        return undefined;
      }
      session.usage.modelRequests += 1;
      let result: AgentModelResult;
      try {
        result = await this.model.run(context.messages, context.tools, this.signal);
      } catch (error) {
        if (this.signal.aborted) {
          this.cancel();
          return undefined;
        }
        result = {
          text: '',
          toolCalls: [],
          finishReason: 'unknown',
          error: {
            provider: this.session.routing.selected?.provider ?? 'openrouter',
            kind: 'unknown',
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
          },
        };
      }

      if (result.usage?.inputTokens) {
        session.usage.inputTokens += result.usage.inputTokens;
      }
      if (result.usage?.outputTokens) {
        session.usage.outputTokens += result.usage.outputTokens;
      }

      if (!result.error) {
        return result;
      }
      const error = classifyProviderError(result.error);
      if (error.agentClass === 'cancelled') {
        return result;
      }
      if (error.agentClass === 'transient' && attempt < session.budget.maxProviderRetries) {
        await this.sleep(retryDelayMs(result.error, attempt + 1), this.signal);
        continue;
      }
      return result;
    }

    return undefined;
  }

  private async runTool(call: ToolCall): Promise<void> {
    this.emit({
      type: 'tool.requested',
      sessionId: this.session.id,
      call,
      at: this.timestamp(),
    });
    const parsed = parseArguments(call.argumentsJson);
    if (!parsed.ok) {
      const observation: ToolObservation = {
        toolId: call.name,
        callId: call.id,
        ok: false,
        error: {
          code: 'invalid_arguments',
          message: 'Tool arguments are not valid JSON.',
          retryable: false,
        },
      };
      this.recordTool(call, observation);
      this.emit({
        type: 'tool.completed',
        sessionId: this.session.id,
        callId: call.id,
        ok: false,
        summary: 'invalid_arguments',
        at: this.timestamp(),
      });
      return;
    }

    const key = `${call.name}\u0000${stableStringify(parsed.value)}`;
    const previous = this.lastTool;
    if (
      previous &&
      previous.key === key &&
      !previous.descriptor.idempotent &&
      previous.observation.ok
    ) {
      previous.consecutive += 1;
      if (previous.consecutive > this.session.budget.maxConsecutiveDuplicateCalls) {
        const observation: ToolObservation = {
          ...previous.observation,
          callId: call.id,
          cached: true,
        };
        this.recordTool(call, observation);
        this.emit({
          type: 'tool.completed',
          sessionId: this.session.id,
          callId: call.id,
          ok: true,
          summary: 'duplicate_call_suppressed',
          at: this.timestamp(),
        });
        return;
      }
    } else {
      const descriptor = this.tools.listTools().find((tool) => tool.name === call.name);
      this.lastTool = descriptor
        ? {
            key,
            descriptor,
            observation: { toolId: call.name, callId: call.id, ok: false },
            consecutive: 0,
          }
        : undefined;
    }

    const descriptor = this.lastTool?.descriptor;
    if (!descriptor) {
      const observation: ToolObservation = {
        toolId: call.name,
        callId: call.id,
        ok: false,
        error: {
          code: 'invalid_arguments',
          message: `Unknown tool: ${call.name}`,
          retryable: false,
        },
      };
      this.recordTool(call, observation);
      this.emit({
        type: 'tool.completed',
        sessionId: this.session.id,
        callId: call.id,
        ok: false,
        summary: 'unknown_tool',
        at: this.timestamp(),
      });
      return;
    }

    this.emit({
      type: 'tool.started',
      sessionId: this.session.id,
      callId: call.id,
      at: this.timestamp(),
    });

    let result: AgentToolExecutionResult;
    try {
      result = await this.tools.execute(call, parsed.value, {
        session: this.session,
        signal: this.signal,
      });
    } catch (error) {
      if (this.signal.aborted) {
        throw error;
      }
      result = {
        ok: false,
        error: {
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
      };
    }

    if (this.signal.aborted) {
      this.cancel();
      return;
    }

    const observation: ToolObservation = {
      toolId: descriptor.name,
      callId: call.id,
      ok: result.ok,
      ...(result.ok && result.data !== undefined ? { data: result.data } : {}),
      ...(!result.ok && result.error ? { error: result.error } : {}),
      ...(result.cached !== undefined ? { cached: result.cached } : {}),
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    };
    this.recordTool(call, observation);
    if (this.lastTool) {
      this.lastTool.observation = observation;
    }
    this.emit({
      type: 'tool.completed',
      sessionId: this.session.id,
      callId: call.id,
      ok: result.ok,
      summary: result.ok ? 'ok' : (result.error?.code ?? 'error'),
      at: this.timestamp(),
    });
  }

  private lastTool:
    | {
        key: string;
        descriptor: AgentToolDescriptor;
        observation: ToolObservation;
        consecutive: number;
      }
    | undefined;

  private recordTool(call: ToolCall, observation: ToolObservation): void {
    this.session.usage.toolCalls += 1;
    const action: ActionRecord = {
      id: `${call.id}-action`,
      at: this.timestamp(),
      call,
      observation,
    };
    this.session.actions.push(action);
    this.addToolTurn(
      call.id,
      call.name,
      observation.ok
        ? JSON.stringify(observation.data ?? null)
        : JSON.stringify(observation.error ?? { code: 'error' }),
    );
    this.touch();
  }

  private async verify(): Promise<VerificationResult> {
    const result = await this.verification.evaluate(this.session.task.acceptanceCriteria, {
      session: this.session,
      workspaceRoots: this.session.task.workspaceRoots,
    });
    this.session.verification = result;
    this.emit({
      type: 'verification.completed',
      sessionId: this.session.id,
      result,
      at: this.timestamp(),
    });
    return result;
  }

  private addAssistantTurn(content: string, toolCalls?: ToolCall[]): void {
    this.session.conversation.push({
      id: `${this.session.id}-assistant-${this.session.conversation.length}`,
      role: 'assistant',
      content,
      createdAt: this.timestamp(),
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    });
    this.touch();
  }

  private addToolTurn(callId: string, name: string, content: string): void {
    this.session.conversation.push({
      id: `${this.session.id}-tool-${this.session.conversation.length}`,
      role: 'tool',
      content,
      createdAt: this.timestamp(),
      toolCallId: callId,
      name,
    });
    this.touch();
  }

  private addSystemTurn(content: string): void {
    this.session.conversation.push({
      id: `${this.session.id}-system-${this.session.conversation.length}`,
      role: 'system',
      content,
      createdAt: this.timestamp(),
    });
    this.touch();
  }

  private transition(status: AgentSession['status']): void {
    this.session.status = status;
    this.touch();
  }

  private cancel(): AgentSession {
    this.transition('cancelled');
    this.emit({ type: 'agent.cancelled', sessionId: this.session.id, at: this.timestamp() });
    return this.session;
  }

  private fail(error: unknown): AgentSession {
    const info = error instanceof AgentError ? agentErrorInfo(error) : agentErrorInfo(error);
    this.session.status = statusForError(info);
    this.session.error = { code: info.code, message: info.message, retryable: info.retryable };
    this.touch();
    if (info.class === 'quota') {
      this.emit({
        type: 'quota.warning',
        sessionId: this.session.id,
        provider: this.session.routing.selected?.provider ?? 'unknown',
        message: info.message,
        at: this.timestamp(),
      });
    }
    this.emit({
      type: 'agent.failed',
      sessionId: this.session.id,
      error: this.session.error,
      at: this.timestamp(),
    });
    return this.session;
  }

  private touch(): void {
    this.session.updatedAt = this.timestamp();
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }

  private emit(event: AgentEvent): void {
    try {
      this.events.emit(event);
    } catch {
      // UI observers must not break the loop.
    }
  }
}
