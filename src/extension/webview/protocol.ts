import type { AgentMode } from '../../core/state';
import type { FreeTierClass, ProviderId } from '../../providers/types';
import { ROUTING_POLICIES, isRoutingPolicy, type RoutingPolicy } from '../../router/policy';

export type { AgentMode };
export type MessageStatus = 'complete' | 'streaming' | 'error' | 'cancelled';
export type ErrorAction = 'retry' | 'settings' | 'refreshModels';

export interface PublicMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  provider?: ProviderId;
  modelId?: string;
  status: MessageStatus;
  error?: string;
}

export interface PublicModel {
  id: string;
  name: string;
  freeTierClass: FreeTierClass;
  capabilities: string[];
  available: boolean;
  reason?: string;
}

export interface PublicProvider {
  id: ProviderId;
  label: string;
  configured: boolean;
  freeTierClass: FreeTierClass;
  models: PublicModel[];
  error?: string;
}

export interface PublicSelection {
  provider: ProviderId;
  modelId: string;
}

export interface PublicDecision extends PublicSelection {
  reason: string;
  automatic: boolean;
}

export interface PublicUiState {
  mode: AgentMode;
  providers: PublicProvider[];
  selected?: PublicSelection;
  lastDecision?: PublicDecision;
  policy: RoutingPolicy;
  allowPaid: boolean;
  maxCostUsd: number;
  preferredProvider?: ProviderId;
  session: {
    messages: PublicMessage[];
    status: 'idle' | 'streaming' | 'cancelling';
    activeRequestId?: string;
  };
}

export interface PublicPermissionRequest {
  id: string;
  title: string;
  detail: string;
  kind: 'command' | 'edit';
  command?: string;
  diff?: string;
}

export type HostToWebview =
  | { type: 'init'; state: PublicUiState }
  | { type: 'state'; state: PublicUiState }
  | {
      type: 'assistant.start';
      requestId: string;
      messageId: string;
      provider: ProviderId;
      modelId: string;
    }
  | { type: 'assistant.delta'; requestId: string; messageId: string; text: string }
  | {
      type: 'assistant.end';
      requestId: string;
      messageId: string;
      status: MessageStatus;
      content: string;
      error?: string;
    }
  | {
      type: 'tool.activity';
      id: string;
      requestId?: string;
      label: string;
      status: 'running' | 'ok' | 'error';
    }
  | { type: 'permission.request'; request: PublicPermissionRequest }
  | { type: 'permission.resolved'; id: string; approved: boolean }
  | {
      type: 'error';
      requestId?: string;
      message: string;
      recoverable: boolean;
      actions: ErrorAction[];
    };

export type WebviewToHost =
  | { type: 'ready' }
  | {
      type: 'chat.send';
      requestId: string;
      message: string;
      provider?: ProviderId;
      modelId?: string;
    }
  | { type: 'chat.cancel'; requestId: string }
  | { type: 'chat.retry'; requestId: string }
  | { type: 'model.select'; provider: ProviderId; modelId: string }
  | { type: 'model.auto' }
  | { type: 'mode.set'; mode: AgentMode }
  | { type: 'models.refresh' }
  | { type: 'credentials.manage'; provider: ProviderId; action: 'set' | 'delete' }
  | { type: 'settings.update'; key: 'policy' | 'preferredProvider'; value: string }
  | { type: 'settings.open' };

export const MAX_WEBVIEW_MESSAGE_CHARS = 64 * 1024;
export const MAX_CHAT_MESSAGE_CHARS = 32 * 1024;
const MAX_ID_CHARS = 80;
const MAX_MODEL_ID_CHARS = 200;

const PROVIDER_IDS: readonly ProviderId[] = ['openrouter', 'groq'];
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

function isValidRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_CHARS &&
    REQUEST_ID_PATTERN.test(value)
  );
}

function optionalProvider(value: unknown): ProviderId | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return isProviderId(value) ? value : undefined;
}

function optionalModelId(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > MAX_MODEL_ID_CHARS) {
    return null;
  }
  return value;
}

export function parseWebviewMessage(input: unknown): WebviewToHost | undefined {
  if (!isRecord(input) || typeof input.type !== 'string') {
    return undefined;
  }

  switch (input.type) {
    case 'ready':
      return { type: 'ready' };
    case 'chat.send': {
      if (
        !isValidRequestId(input.requestId) ||
        typeof input.message !== 'string' ||
        input.message.trim().length === 0 ||
        input.message.length > MAX_CHAT_MESSAGE_CHARS
      ) {
        return undefined;
      }
      const provider = optionalProvider(input.provider);
      const modelId = optionalModelId(input.modelId);
      if (modelId === null) {
        return undefined;
      }
      if (input.provider !== undefined && provider === undefined) {
        return undefined;
      }
      if ((provider === undefined) !== (modelId === undefined)) {
        return undefined;
      }
      return {
        type: 'chat.send',
        requestId: input.requestId,
        message: input.message,
        provider,
        modelId,
      };
    }
    case 'chat.cancel':
      return isValidRequestId(input.requestId)
        ? { type: 'chat.cancel', requestId: input.requestId }
        : undefined;
    case 'chat.retry':
      return isValidRequestId(input.requestId)
        ? { type: 'chat.retry', requestId: input.requestId }
        : undefined;
    case 'model.select': {
      if (
        !isProviderId(input.provider) ||
        typeof input.modelId !== 'string' ||
        input.modelId.length === 0 ||
        input.modelId.length > MAX_MODEL_ID_CHARS
      ) {
        return undefined;
      }
      return {
        type: 'model.select',
        provider: input.provider,
        modelId: input.modelId,
      };
    }
    case 'model.auto':
      return { type: 'model.auto' };
    case 'mode.set':
      return input.mode === 'ask' ||
        input.mode === 'plan' ||
        input.mode === 'review' ||
        input.mode === 'build' ||
        input.mode === 'debug'
        ? { type: 'mode.set', mode: input.mode }
        : undefined;
    case 'models.refresh':
      return { type: 'models.refresh' };
    case 'credentials.manage':
      if (!isProviderId(input.provider) || (input.action !== 'set' && input.action !== 'delete')) {
        return undefined;
      }
      return {
        type: 'credentials.manage',
        provider: input.provider,
        action: input.action,
      };
    case 'settings.update': {
      if (input.key === 'policy') {
        if (!isRoutingPolicy(input.value)) {
          return undefined;
        }
        return { type: 'settings.update', key: 'policy', value: input.value };
      }
      if (input.key === 'preferredProvider') {
        if (input.value !== '' && !isProviderId(input.value)) {
          return undefined;
        }
        return { type: 'settings.update', key: 'preferredProvider', value: input.value };
      }
      return undefined;
    }
    case 'settings.open':
      return { type: 'settings.open' };
    default:
      return undefined;
  }
}

export function isKnownPolicy(value: string): value is RoutingPolicy {
  return (ROUTING_POLICIES as readonly string[]).includes(value);
}
