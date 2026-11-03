import type { SessionCommandAllowlist } from '../security/approvals';
import type { PermissionDecision, PermissionManager, PermissionRequest } from './types';

export class ReadOnlyPermissionManager implements PermissionManager {
  async authorize(request: PermissionRequest): Promise<PermissionDecision> {
    return request.permission === 'read' ? 'allow' : 'deny';
  }
}

export class DenyAllPermissionManager implements PermissionManager {
  async authorize(): Promise<PermissionDecision> {
    return 'deny';
  }
}

export class DefaultPermissionManager implements PermissionManager {
  async authorize(request: PermissionRequest): Promise<PermissionDecision> {
    if (request.permission === 'read') {
      return 'allow';
    }
    if (request.permission === 'destructive') {
      return 'deny';
    }
    return 'ask';
  }
}

export class TrustAwarePermissionManager implements PermissionManager {
  constructor(
    private readonly trusted: boolean,
    private readonly delegate: PermissionManager,
  ) {}

  async authorize(request: PermissionRequest): Promise<PermissionDecision> {
    if (!this.trusted && request.permission !== 'read') {
      return 'deny';
    }
    return this.delegate.authorize(request);
  }
}

export class SessionAwarePermissionManager implements PermissionManager {
  constructor(
    private readonly trusted: boolean,
    private readonly delegate: PermissionManager,
    private readonly approvals: SessionCommandAllowlist,
  ) {}

  async authorize(request: PermissionRequest): Promise<PermissionDecision> {
    if (!this.trusted && request.permission !== 'read') {
      return 'deny';
    }
    if (
      request.permission === 'execute' &&
      request.command &&
      this.approvals.isAllowed(request.sessionId, request.command)
    ) {
      return 'allow';
    }
    return this.delegate.authorize(request);
  }
}
