import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditEntry, AuditLogger } from '../tools/types';

export class MemoryAuditLogger implements AuditLogger {
  readonly entries: AuditEntry[] = [];

  record(entry: AuditEntry): void {
    this.entries.push({ ...entry });
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export class FileAuditLogger implements AuditLogger {
  constructor(private readonly filePath: string) {}

  async record(entry: AuditEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}
