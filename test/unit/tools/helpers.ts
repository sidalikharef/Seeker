import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryAuditLogger } from '../../../src/security/audit';
import type {
  PermissionDecision,
  PermissionManager,
  PermissionRequest,
  ToolContext,
} from '../../../src/tools/types';

export interface TestWorkspace {
  root: string;
  cleanup(): Promise<void>;
}

export async function makeWorkspace(
  files: Record<string, string | Buffer> = {},
): Promise<TestWorkspace> {
  const root = await mkdtemp(join(tmpdir(), 'seeker-tools-'));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  return {
    root,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export class AllowAllPermissionManager implements PermissionManager {
  readonly requests: PermissionRequest[] = [];

  async authorize(request: PermissionRequest): Promise<PermissionDecision> {
    this.requests.push(request);
    return 'allow';
  }
}

export class DenyAllPermissionManager implements PermissionManager {
  readonly requests: PermissionRequest[] = [];

  async authorize(request: PermissionRequest): Promise<PermissionDecision> {
    this.requests.push(request);
    return 'deny';
  }
}

export function createContext(
  root: string,
  overrides: Partial<ToolContext> = {},
): ToolContext & { logger: MemoryAuditLogger; permissions: PermissionManager } {
  return {
    sessionId: 'test-session',
    workspaceRoots: [root],
    signal: new AbortController().signal,
    logger: new MemoryAuditLogger(),
    permissions: new AllowAllPermissionManager(),
    mode: 'build',
    ...overrides,
  } as ToolContext & { logger: MemoryAuditLogger; permissions: PermissionManager };
}
