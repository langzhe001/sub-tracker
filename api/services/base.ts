import { MIN_ENCRYPTION_KEY_LENGTH } from './crypto';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

export abstract class BaseEncryptedService {
  constructor(protected db: DrizzleD1Database, protected encryptionKey?: string) {}

  protected validateEncryptionKey(): string {
    if (!this.encryptionKey || this.encryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
      throw new Error('Encryption key is missing or too short');
    }
    return this.encryptionKey;
  }
}
