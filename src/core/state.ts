import type { ProviderId, ToolCall } from '../providers/types';
import type { RoutingPolicy } from '../router/policy';
import type { ToolError, ToolMode } from '../tools/types';

export type AgentMode = ToolMode;

export type SessionStatus =
  | 'idle'
  | 'planning'
  | 'awaiting_model'
  | 'awaiting_tool'
  | 'awaiting_permission'
  | 'executing'
  | 'verifying'
  | 'paused_quota'
  | 'completed'
  | 'completed_unverified'
  | 'cancelled'
  | 'failed';

export type AcceptanceCriterionKind =
  | 'file-exists'
  | 'file-contains'
  | 'command-exit-zero'
  | 'diagnostics-empty'
  | 'test-passed'
  | 'diff-contains'
  | 'manual';

export interface AcceptanceCriterion {
  id: string;
  description: string;
  kind: AcceptanceCriterionKind;
  params: Record<string, unknown>;
  required: boolean;
}

export interface TaskBudget {
  maxIterations: number;
  maxModelRequests: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxCostUsd: number;
  maxWallClockMs: number;
  maxToolCalls: number;
  maxToolCallsPerTurn: number;
  maxConsecutiveDuplicateCalls: number;
  maxProviderRetries: number;
}

export const DEFAULT_TASK_BUDGET: TaskBudget = {
  maxIterations: 40,
  maxModelRequests: 40,
  maxCostUsd: 0,
  maxWallClockMs: 30 * 60_000,
  maxToolCalls: 80,
  maxToolCallsPerTurn: 8,
  maxConsecutiveDuplicateCalls: 2,
  maxProviderRetries: 3,
};

export interface SessionUsage {
  modelRequests: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface ConversationTurn {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  tokenEstimate?: number;
  compacted?: boolean;
}

export interface ToolObservation {
  toolId: string;
  callId: string;
  ok: boolean;
  data?: unknown;
  error?: ToolError;
  cached?: boolean;
  durationMs?: number;
}

export interface ActionRecord {
  id: string;
  at: string;
  call: ToolCall;
  observation: ToolObservation;
}

export interface VerificationCriterionResult {
  id: string;
  passed: boolean;
  evidence?: string;
  error?: string;
}

export interface VerificationResult {
  satisfied: boolean;
  criteria: VerificationCriterionResult[];
  unverified: string[];
}

export interface AgentSession {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  mode: AgentMode;
  task: {
    prompt: string;
    acceptanceCriteria: AcceptanceCriterion[];
    workspaceRoots: string[];
  };
  routing: {
    policy: RoutingPolicy;
    allowPaid: boolean;
    maxCostUsd: number;
    selected?: { provider: ProviderId; modelId: string; reason: string };
  };
  budget: TaskBudget;
  usage: SessionUsage;
  conversation: ConversationTurn[];
  actions: ActionRecord[];
  verification?: VerificationResult;
  error?: { code: string; message: string; retryable: boolean };
}

export interface CreateSessionOptions {
  id: string;
  prompt: string;
  mode: AgentMode;
  workspaceRoots: string[];
  policy: RoutingPolicy;
  allowPaid?: boolean;
  maxCostUsd?: number;
  acceptanceCriteria?: AcceptanceCriterion[];
  budget?: Partial<TaskBudget>;
  now?: () => number;
}

export function createSession(options: CreateSessionOptions): AgentSession {
  const now = new Date((options.now ?? Date.now)()).toISOString();
  return {
    schemaVersion: 1,
    id: options.id,
    createdAt: now,
    updatedAt: now,
    status: 'idle',
    mode: options.mode,
    task: {
      prompt: options.prompt,
      acceptanceCriteria: options.acceptanceCriteria ?? [],
      workspaceRoots: [...options.workspaceRoots],
    },
    routing: {
      policy: options.policy,
      allowPaid: options.allowPaid ?? false,
      maxCostUsd: options.maxCostUsd ?? 0,
    },
    budget: { ...DEFAULT_TASK_BUDGET, ...options.budget },
    usage: {
      modelRequests: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    },
    conversation: [
      {
        id: `${options.id}-prompt`,
        role: 'user',
        content: options.prompt,
        createdAt: now,
      },
    ],
    actions: [],
  };
}
