import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { hash, verify, validatePassword, validateEmail } from './password';
import { createToken } from './jwt';
import { encrypt, hmacHash, isEncrypted, decrypt, MIN_ENCRYPTION_KEY_LENGTH } from './crypto';
import type { Env, JwtPayload, RegisterRequest, LoginRequest } from '../types';

export class AuthService {
  constructor(
    private db: ReturnType<typeof drizzle<typeof schema>>,
    private encryptionKey?: string
  ) {}

  private validateEncryptionKey(): string {
    if (!this.encryptionKey || this.encryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
      throw new Error('Encryption key is missing or too short');
    }
    return this.encryptionKey;
  }

  async register(req: RegisterRequest, env: Env): Promise<{ token: string; user: { id: string; email: string } } | null> {
    const emailCheck = validateEmail(req.email);
    if (!emailCheck.valid) {
      return null;
    }

    const passwordCheck = validatePassword(req.password);
    if (!passwordCheck.valid) {
      return null;
    }

    const normalizedEmail = req.email.trim().toLowerCase();
    const key = this.validateEncryptionKey();

    // 用 HMAC 哈希查询邮箱是否已注册（确定性查询，不暴露明文邮箱）
    const emailHash = await hmacHash(normalizedEmail, key);

    const existingUserArr = (await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.emailHash, emailHash))
      .all()) as unknown as Array<{ id: string; emailHash: string }>;
    if (existingUserArr.length > 0) {
      return null;
    }

    const id = crypto.randomUUID();
    const passwordHash = await hash(req.password);
    // 邮箱以 AES-GCM 密文存储（随机 IV，无法被反查）
    const encryptedEmail = await encrypt(normalizedEmail, key);

    await this.db.insert(schema.users).values({
      id,
      email: encryptedEmail,
      emailHash,
      passwordHash
    }).run();

    const token = await createToken(id, normalizedEmail, env.JWT_SECRET);

    return { token, user: { id, email: normalizedEmail } };
  }

  async login(req: LoginRequest, env: Env): Promise<{ token: string; user: { id: string; email: string } } | null> {
    if (!req.email || !req.password) {
      return null;
    }

    const emailCheck = validateEmail(req.email);
    if (!emailCheck.valid) {
      await verify('', req.password);
      return null;
    }

    const passwordCheck = validatePassword(req.password);
    if (!passwordCheck.valid) {
      return null;
    }

    const normalizedEmail = req.email.trim().toLowerCase();
    const key = this.validateEncryptionKey();

    // 用 HMAC 哈希查询用户（避免全表扫描 + 不暴露明文邮箱）
    const emailHash = await hmacHash(normalizedEmail, key);

    const userArr = (await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.emailHash, emailHash))
      .all()) as unknown as Array<{ id: string; email: string; emailHash: string; passwordHash: string }>;
    if (userArr.length === 0) {
      await verify('v2:100000:dummy:dummy', req.password);
      return null;
    }
    const user = userArr[0];

    const valid = await verify(user.passwordHash, req.password);
    if (!valid) {
      return null;
    }

    // 解密存储的邮箱用于签发 JWT（保持 payload 可读，便于前端展示）
    let plainEmail = normalizedEmail;
    if (isEncrypted(user.email)) {
      try {
        plainEmail = await decrypt(user.email, key);
      } catch {
        plainEmail = normalizedEmail;
      }
    }

    const token = await createToken(user.id, plainEmail, env.JWT_SECRET);

    return { token, user: { id: user.id, email: plainEmail } };
  }

  async verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
    try {
      const { verifyToken: verifyJwt } = await import('./jwt');
      return await verifyJwt(token, secret);
    } catch {
      return null;
    }
  }
}

export function createAuthService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey?: string
): AuthService {
  return new AuthService(db, encryptionKey);
}
