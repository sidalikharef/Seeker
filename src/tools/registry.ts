import type { PermissionClass, Tool, ToolMode } from './types';

const MODE_PERMISSIONS: Record<ToolMode, ReadonlySet<PermissionClass>> = {
  ask: new Set(['read']),
  plan: new Set(['read']),
  build: new Set(['read', 'write', 'execute']),
  debug: new Set(['read', 'write', 'execute']),
  review: new Set(['read']),
};

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool ${tool.id} is already registered.`);
    }
    this.tools.set(tool.id, tool);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  list(): Tool[] {
    return [...this.tools.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  isAllowedInMode(tool: Tool, mode: ToolMode): boolean {
    return MODE_PERMISSIONS[mode].has(tool.permission);
  }

  listForMode(mode: ToolMode): Tool[] {
    return this.list().filter((tool) => this.isAllowedInMode(tool, mode));
  }
}
