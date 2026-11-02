import type * as vscode from 'vscode';
import type { CredentialProvider, ProviderId } from '../providers/types';

const SECRET_PREFIX = 'seeker.providers.';

export function secretKey(provider: ProviderId): string {
  return `${SECRET_PREFIX}${provider}.apiKey`;
}

export class SecretStorageCredentialProvider implements CredentialProvider {
  private readonly storage: vscode.SecretStorage;

  constructor(storage: vscode.SecretStorage) {
    this.storage = storage;
  }

  async get(provider: ProviderId): Promise<string | undefined> {
    return this.storage.get(secretKey(provider));
  }

  async set(provider: ProviderId, key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) {
      throw new Error('API key cannot be empty.');
    }
    await this.storage.store(secretKey(provider), trimmed);
  }

  async delete(provider: ProviderId): Promise<void> {
    await this.storage.delete(secretKey(provider));
  }

  async has(provider: ProviderId): Promise<boolean> {
    return (await this.get(provider)) !== undefined;
  }
}
