import { describe, expect, it } from 'vitest';
import {
  DefaultPermissionManager,
  DenyAllPermissionManager,
  ReadOnlyPermissionManager,
  SessionAwarePermissionManager,
  TrustAwarePermissionManager,
} from '../../../src/tools/permissions';
import { SessionCommandAllowlist } from '../../../src/security/approvals';
import type { PermissionRequest } from '../../../src/tools/types';
import { AllowAllPermissionManager } from './helpers';

function request(permission: PermissionRequest['permission']): PermissionRequest {
  return {
    sessionId: 'test',
    toolId: 'test.tool',
    permission,
    summary: 'test',
    risk: permission === 'read' ? 'low' : 'medium',
  };
}

const command = {
  workspace: '/workspace',
  file: 'pnpm',
  args: ['typecheck'],
  cwd: '/workspace',
};

describe('permission managers', () => {
  it('allows only reads by default', async () => {
    const manager = new ReadOnlyPermissionManager();

    await expect(manager.authorize(request('read'))).resolves.toBe('allow');
    await expect(manager.authorize(request('write'))).resolves.toBe('deny');
    await expect(manager.authorize(request('execute'))).resolves.toBe('deny');
    await expect(manager.authorize(request('destructive'))).resolves.toBe('deny');
  });

  it('denies everything explicitly', async () => {
    const manager = new DenyAllPermissionManager();

    await expect(manager.authorize()).resolves.toBe('deny');
    await expect(manager.authorize()).resolves.toBe('deny');
  });

  it('blocks privileged actions in untrusted workspaces', async () => {
    const trusted = new TrustAwarePermissionManager(true, new AllowAllPermissionManager());
    const untrusted = new TrustAwarePermissionManager(false, new AllowAllPermissionManager());

    await expect(trusted.authorize(request('write'))).resolves.toBe('allow');
    await expect(untrusted.authorize(request('read'))).resolves.toBe('allow');
    await expect(untrusted.authorize(request('write'))).resolves.toBe('deny');
    await expect(untrusted.authorize(request('execute'))).resolves.toBe('deny');
  });

  it('asks for writes and commands but denies destructive actions by default', async () => {
    const manager = new DefaultPermissionManager();

    await expect(manager.authorize(request('read'))).resolves.toBe('allow');
    await expect(manager.authorize(request('write'))).resolves.toBe('ask');
    await expect(manager.authorize(request('execute'))).resolves.toBe('ask');
    await expect(manager.authorize(request('destructive'))).resolves.toBe('deny');
  });

  it('allows only exact session-approved commands', async () => {
    const approvals = new SessionCommandAllowlist();
    const manager = new SessionAwarePermissionManager(
      true,
      new DefaultPermissionManager(),
      approvals,
    );
    const execute = { ...request('execute'), command };

    await expect(manager.authorize(execute)).resolves.toBe('ask');

    approvals.allow('test', command);
    await expect(manager.authorize(execute)).resolves.toBe('allow');
    await expect(
      manager.authorize({ ...execute, command: { ...command, args: ['typecheck', '--watch'] } }),
    ).resolves.toBe('ask');
    await expect(manager.authorize({ ...execute, command: undefined })).resolves.toBe('ask');
  });

  it('never allows session rules in an untrusted workspace', async () => {
    const approvals = new SessionCommandAllowlist();
    approvals.allow('test', command);
    const manager = new SessionAwarePermissionManager(
      false,
      new DefaultPermissionManager(),
      approvals,
    );

    await expect(manager.authorize({ ...request('execute'), command })).resolves.toBe('deny');
  });
});
