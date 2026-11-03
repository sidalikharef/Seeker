import type { AgentEvent } from './events';
import { createSession, type AgentSession, type CreateSessionOptions } from './state';

export interface SessionStorage {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T | undefined): void | Promise<void>;
}

const SESSION_PREFIX = 'seeker.agent.session.v1.';
const EVENT_PREFIX = 'seeker.agent.events.v1.';
const INDEX_KEY = 'seeker.agent.session-index.v1';

function sessionKey(id: string): string {
  return `${SESSION_PREFIX}${id}`;
}

function eventKey(id: string): string {
  return `${EVENT_PREFIX}${id}`;
}

function isSession(value: unknown): value is AgentSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const session = value as Partial<AgentSession>;
  return (
    session.schemaVersion === 1 &&
    typeof session.id === 'string' &&
    typeof session.status === 'string' &&
    typeof session.mode === 'string' &&
    typeof session.task === 'object' &&
    session.task !== null &&
    typeof session.task.prompt === 'string'
  );
}

export class SessionManager {
  private readonly storage: SessionStorage;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(options: { storage: SessionStorage; now?: () => number; createId?: () => string }) {
    this.storage = options.storage;
    this.now = options.now ?? Date.now;
    this.createId =
      options.createId ??
      (() =>
        globalThis.crypto?.randomUUID?.() ??
        `session-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  create(options: Omit<CreateSessionOptions, 'id' | 'now'> & { id?: string }): AgentSession {
    const session = createSession({
      ...options,
      id: options.id ?? this.createId(),
      now: this.now,
    });
    this.save(session);
    return session;
  }

  save(session: AgentSession): void {
    session.updatedAt = new Date(this.now()).toISOString();
    this.storage.set(sessionKey(session.id), session);
    const index = new Set(this.storage.get<string[]>(INDEX_KEY) ?? []);
    if (!index.has(session.id)) {
      index.add(session.id);
      this.storage.set(INDEX_KEY, [...index]);
    }
  }

  load(id: string): AgentSession | undefined {
    const value = this.storage.get<unknown>(sessionKey(id));
    return isSession(value) ? value : undefined;
  }

  list(): AgentSession[] {
    const ids = this.storage.get<string[]>(INDEX_KEY) ?? [];
    return ids
      .map((id) => this.load(id))
      .filter((session): session is AgentSession => session !== undefined)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  appendEvent(sessionId: string, event: AgentEvent): void {
    const events = this.storage.get<AgentEvent[]>(eventKey(sessionId)) ?? [];
    events.push(event);
    this.storage.set(eventKey(sessionId), events);
  }

  loadEvents(sessionId: string): AgentEvent[] {
    return [...(this.storage.get<AgentEvent[]>(eventKey(sessionId)) ?? [])];
  }

  delete(id: string): void {
    this.storage.set(sessionKey(id), undefined);
    this.storage.set(eventKey(id), undefined);
    const index = new Set(this.storage.get<string[]>(INDEX_KEY) ?? []);
    index.delete(id);
    this.storage.set(INDEX_KEY, [...index]);
  }
}
