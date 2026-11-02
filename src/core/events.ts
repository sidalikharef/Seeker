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
