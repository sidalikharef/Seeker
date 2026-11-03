import type { PermissionClass, Tool, ToolMode } from '../tools/types';
import type { AgentMode } from './state';

export interface ModePolicy {
  allowedPermissions: ReadonlySet<PermissionClass>;
  write: boolean;
  execute: boolean;
  taskKind: 'chat' | 'plan' | 'code' | 'debug' | 'review';
}

const READ_ONLY = new Set<PermissionClass>(['read']);

export const MODE_POLICIES: Record<AgentMode, ModePolicy> = {
  ask: { allowedPermissions: READ_ONLY, write: false, execute: false, taskKind: 'chat' },
  plan: { allowedPermissions: READ_ONLY, write: false, execute: false, taskKind: 'plan' },
  build: {
    allowedPermissions: new Set<PermissionClass>(['read', 'write', 'execute']),
    write: true,
    execute: true,
    taskKind: 'code',
  },
  debug: {
    allowedPermissions: new Set<PermissionClass>(['read', 'write', 'execute']),
    write: true,
    execute: true,
    taskKind: 'debug',
  },
  review: { allowedPermissions: READ_ONLY, write: false, execute: false, taskKind: 'review' },
};

export function modeAllowsPermission(mode: AgentMode, permission: PermissionClass): boolean {
  return MODE_POLICIES[mode].allowedPermissions.has(permission);
}

export function modeAllowsTool(mode: ToolMode, tool: Tool): boolean {
  return modeAllowsPermission(mode, tool.permission);
}

export function toolsForMode(mode: AgentMode, tools: readonly Tool[]): Tool[] {
  return tools.filter((tool) => modeAllowsTool(mode, tool));
}
