import { readFile } from 'node:fs/promises';
import { resolveWorkspacePath } from '../security/paths';
import type {
  AcceptanceCriterion,
  ActionRecord,
  AgentSession,
  VerificationCriterionResult,
  VerificationResult,
} from './state';

export interface VerificationContext {
  session: AgentSession;
  workspaceRoots: string[];
}

export interface VerificationEngine {
  evaluate(
    criteria: readonly AcceptanceCriterion[],
    context: VerificationContext,
  ): Promise<VerificationResult>;
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function lastAction(
  actions: readonly ActionRecord[],
  predicate: (action: ActionRecord) => boolean,
): ActionRecord | undefined {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action && predicate(action)) {
      return action;
    }
  }
  return undefined;
}

function actionOutput(action: ActionRecord): string {
  if (!action.observation.ok) {
    return '';
  }
  try {
    return JSON.stringify(action.observation.data) ?? '';
  } catch {
    return '';
  }
}

async function evaluateFileCriterion(
  criterion: AcceptanceCriterion,
  roots: string[],
): Promise<VerificationCriterionResult> {
  const path = stringParam(criterion.params, 'path');
  if (!path) {
    return { id: criterion.id, passed: false, error: 'missing path parameter' };
  }

  const resolution = await resolveWorkspacePath(path, roots, { mustExist: true });
  if (!resolution.ok) {
    return { id: criterion.id, passed: false, error: resolution.message };
  }
  if (criterion.kind === 'file-exists') {
    return { id: criterion.id, passed: true, evidence: resolution.path.workspaceRelative };
  }

  const text = stringParam(criterion.params, 'text');
  if (text === undefined) {
    return { id: criterion.id, passed: false, error: 'missing text parameter' };
  }
  try {
    const content = await readFile(resolution.path.absolute, 'utf8');
    return content.includes(text)
      ? { id: criterion.id, passed: true, evidence: resolution.path.workspaceRelative }
      : { id: criterion.id, passed: false, error: `file does not contain "${text}"` };
  } catch (error) {
    return {
      id: criterion.id,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function evaluateCommandCriterion(
  criterion: AcceptanceCriterion,
  actions: readonly ActionRecord[],
): VerificationCriterionResult {
  const toolName = stringParam(criterion.params, 'toolName') ?? 'terminal.execute';
  const text = stringParam(criterion.params, 'text');
  const action = lastAction(
    actions,
    (candidate) => candidate.call.name === toolName && candidate.observation.ok,
  );
  if (!action) {
    return { id: criterion.id, passed: false, error: `no successful ${toolName} action` };
  }
  if (text && !actionOutput(action).includes(text)) {
    return { id: criterion.id, passed: false, error: `output does not contain "${text}"` };
  }
  return {
    id: criterion.id,
    passed: true,
    evidence: `${toolName} call ${action.call.id} exited successfully`,
  };
}

function evaluateDiagnosticsCriterion(
  criterion: AcceptanceCriterion,
  actions: readonly ActionRecord[],
): VerificationCriterionResult {
  const toolName = stringParam(criterion.params, 'toolName') ?? 'diagnostics.get';
  const action = lastAction(
    actions,
    (candidate) => candidate.call.name === toolName && candidate.observation.ok,
  );
  if (!action) {
    return { id: criterion.id, passed: false, error: `no successful ${toolName} action` };
  }
  const data = action.observation.data;
  const diagnostics =
    typeof data === 'object' && data !== null && 'diagnostics' in data
      ? (data as { diagnostics?: unknown }).diagnostics
      : undefined;
  if (Array.isArray(diagnostics) && diagnostics.length > 0) {
    return {
      id: criterion.id,
      passed: false,
      error: `${diagnostics.length} diagnostic(s) remain`,
    };
  }
  return { id: criterion.id, passed: true, evidence: 'no diagnostics reported' };
}

function evaluateDiffCriterion(
  criterion: AcceptanceCriterion,
  actions: readonly ActionRecord[],
): VerificationCriterionResult {
  const text = stringParam(criterion.params, 'text');
  if (!text) {
    return { id: criterion.id, passed: false, error: 'missing text parameter' };
  }
  const action = lastAction(
    actions,
    (candidate) =>
      candidate.observation.ok &&
      (candidate.call.name.includes('write') || candidate.call.name.includes('patch')),
  );
  if (!action || !actionOutput(action).includes(text)) {
    return { id: criterion.id, passed: false, error: `no successful write contains "${text}"` };
  }
  return { id: criterion.id, passed: true, evidence: `write call ${action.call.id}` };
}

async function evaluateCriterion(
  criterion: AcceptanceCriterion,
  context: VerificationContext,
): Promise<VerificationCriterionResult> {
  switch (criterion.kind) {
    case 'file-exists':
    case 'file-contains':
      return evaluateFileCriterion(criterion, context.workspaceRoots);
    case 'command-exit-zero':
    case 'test-passed':
      return evaluateCommandCriterion(criterion, context.session.actions);
    case 'diagnostics-empty':
      return evaluateDiagnosticsCriterion(criterion, context.session.actions);
    case 'diff-contains':
      return evaluateDiffCriterion(criterion, context.session.actions);
    case 'manual':
      return criterion.params.confirmed === true
        ? { id: criterion.id, passed: true, evidence: 'confirmed manually' }
        : { id: criterion.id, passed: false, error: 'manual confirmation required' };
  }
}

export class DefaultVerificationEngine implements VerificationEngine {
  async evaluate(
    criteria: readonly AcceptanceCriterion[],
    context: VerificationContext,
  ): Promise<VerificationResult> {
    const results: VerificationCriterionResult[] = [];
    for (const criterion of criteria) {
      results.push(await evaluateCriterion(criterion, context));
    }

    const required = criteria.filter((criterion) => criterion.required);
    const satisfied =
      required.length > 0 &&
      required.every((criterion) => results.find((result) => result.id === criterion.id)?.passed);
    const unverified = criteria
      .filter((criterion) => !criterion.required)
      .filter((criterion) => !results.find((result) => result.id === criterion.id)?.passed)
      .map((criterion) => criterion.id);

    return { satisfied, criteria: results, unverified };
  }
}
