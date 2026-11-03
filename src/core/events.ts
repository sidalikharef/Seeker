import type { ProviderId } from '../providers/types';

export type AvailabilityEventState =
  | 'unknown'
  | 'healthy'
  | 'degraded'
  | 'rate_limited'
  | 'exhausted'
  | 'auth_required'
  | 'unavailable';

export type SeekerEvent =
  | {
      type: 'model.selected';
      provider: ProviderId;
      modelId: string;
      policy: string;
      reason: string;
      score?: Record<string, number>;
      at: string;
    }
  | {
      type: 'model.fallback';
      from: { provider: ProviderId; modelId: string };
      to: { provider: ProviderId; modelId: string };
      reason: string;
      at: string;
    }
  | {
      type: 'quota.warning';
      provider: ProviderId;
      modelId?: string;
      state: AvailabilityEventState;
      message: string;
      resetAt?: string;
      at: string;
    }
  | {
      type: 'provider.health';
      provider: ProviderId;
      modelId?: string;
      state: AvailabilityEventState;
      message?: string;
      at: string;
    };

export interface EventSink {
  emit(event: SeekerEvent): void;
}

export class MemoryEventSink implements EventSink {
  readonly events: SeekerEvent[] = [];

  emit(event: SeekerEvent): void {
    this.events.push(event);
  }

  clear(): void {
    this.events.length = 0;
  }
}

export type AgentEvent =
  | { type: 'agent.started'; sessionId: string; at: string }
  | { type: 'agent.mode'; sessionId: string; mode: string; at: string }
  | {
      type: 'model.selected';
      sessionId: string;
      provider: string;
      modelId: string;
      reason: string;
      at: string;
    }
  | { type: 'assistant.delta'; sessionId: string; text: string; at: string }
  | { type: 'assistant.reasoning'; sessionId: string; text: string; at: string }
  | {
      type: 'tool.requested';
      sessionId: string;
      call: import('../providers/types').ToolCall;
      at: string;
    }
  | {
      type: 'permission.requested';
      sessionId: string;
      requestId: string;
      request: import('../tools/types').PermissionRequest;
      at: string;
    }
  | {
      type: 'permission.resolved';
      sessionId: string;
      requestId: string;
      approved: boolean;
      at: string;
    }
  | { type: 'tool.started'; sessionId: string; callId: string; at: string }
  | {
      type: 'tool.completed';
      sessionId: string;
      callId: string;
      ok: boolean;
      summary: string;
      at: string;
    }
  | { type: 'quota.warning'; sessionId: string; provider: string; message: string; at: string }
  | {
      type: 'model.fallback';
      sessionId: string;
      from: string;
      to: string;
      reason: string;
      at: string;
    }
  | {
      type: 'verification.completed';
      sessionId: string;
      result: import('./state').VerificationResult;
      at: string;
    }
  | { type: 'agent.completed'; sessionId: string; verified: boolean; at: string }
  | {
      type: 'agent.failed';
      sessionId: string;
      error: { code: string; message: string; retryable: boolean };
      at: string;
    }
  | { type: 'agent.cancelled'; sessionId: string; at: string };

export interface AgentEventSink {
  emit(event: AgentEvent): void;
}

export class MemoryAgentEventSink implements AgentEventSink {
  readonly events: AgentEvent[] = [];

  emit(event: AgentEvent): void {
    this.events.push(event);
  }

  clear(): void {
    this.events.length = 0;
  }
}
