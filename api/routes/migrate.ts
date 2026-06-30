/**
 * 数据迁移端点
 * 用于将已有明文数据加密（防止平台侧数据泄露）
 *
 * 安全措施：
 * - 需要管理员密钥验证（通过 X-Migration-Key 请求头）
 * - 使用常量时间比较防止时序攻击
 * - 迁移密钥不通过 URL 传递，避免日志泄露
 */

import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import {
  encrypt,
  hmacHash,
  isEncrypted,
  MIN_ENCRYPTION_KEY_LENGTH
} from '../services/crypto';
import type { Env } from '../types';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const migrate = new Hono<{ Bindings: Env }>();

/**
 * 常量时间字符串比较，防止时序攻击
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 校验迁移请求的认证与加密密钥配置
 * 返回 null 表示校验失败（已写入失败原因到 c 的响应），否则返回加密密钥
 */
async function authorizeMigration(c: any): Promise<string | Response> {
  const migrationKey = c.req.header('X-Migration-Key');
  if (!migrationKey || !c.env.MIGRATION_KEY || !constantTimeCompare(migrationKey, c.env.MIGRATION_KEY)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  if (!c.env.ENCRYPTION_KEY || c.env.ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) {
    return c.json({ success: false, error: 'Encryption key not configured' }, 500);
  }
  return c.env.ENCRYPTION_KEY;
}

/**
 * 加密所有未加密的通知渠道配置（旧版迁移端点，保留向后兼容）
 * POST /api/migrate/encrypt-channels
 * Header: X-Migration-Key: <MIGRATION_KEY>
 */
migrate.post('/encrypt-channels', async (c) => {
  const authResult = await authorizeMigration(c);
  if (typeof authResult !== 'string') {
    return authResult;
  }
  const key = authResult;
  const db = drizzle(c.env.DB!, { schema });

  const channels = (await db.select().from(schema.notificationChannels).all() as unknown) as Array<{
    id: string;
    config: string;
    name: string;
  }>;

  let encryptedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const channel of channels) {
    try {
      const updates: Record<string, unknown> = {};
      let changed = false;

      if (channel.config && !isEncrypted(channel.config)) {
        updates.config = await encrypt(channel.config, key);
        changed = true;
      }
      if (channel.name && !isEncrypted(channel.name)) {
        updates.name = await encrypt(channel.name, key);
        changed = true;
      }

      if (!changed) {
        skippedCount++;
        continue;
      }

      await db.update(schema.notificationChannels)
        .set(updates)
        .where(eq(schema.notificationChannels.id, channel.id))
        .run();

      encryptedCount++;
    } catch {
      errorCount++;
    }
  }

  return c.json<ApiResponse>({
    success: true,
    data: {
      total: channels.length,
      encrypted: encryptedCount,
      skipped: skippedCount,
      errors: errorCount
    }
  });
});

/**
 * 加密所有表的所有敏感字段（全字段加密迁移）
 * POST /api/migrate/encrypt-all-fields
 * Header: X-Migration-Key: <MIGRATION_KEY>
 *
 * 覆盖范围：
 * - users: email（加密）+ emailHash（HMAC 哈希回填）
 * - subscriptions: name/description/icon/amount/currency/renewalPeriod/expireDate/reminderDays
 * - groups: name/color/icon
 * - notification_channels: name（config 由 encrypt-channels 处理）
 * - notification_logs: errorMessage
 */
migrate.post('/encrypt-all-fields', async (c) => {
  const authResult = await authorizeMigration(c);
  if (typeof authResult !== 'string') {
    return authResult;
  }
  const key = authResult;
  const db = drizzle(c.env.DB!, { schema });

  const stats = {
    users: { total: 0, encrypted: 0, skipped: 0, errors: 0 },
    subscriptions: { total: 0, encrypted: 0, skipped: 0, errors: 0 },
    groups: { total: 0, encrypted: 0, skipped: 0, errors: 0 },
    channels: { total: 0, encrypted: 0, skipped: 0, errors: 0 },
    logs: { total: 0, encrypted: 0, skipped: 0, errors: 0 }
  };

  // 1. 用户表：加密 email + 回填 emailHash
  try {
    const users = (await db.select().from(schema.users).all() as unknown) as Array<{
      id: string;
      email: string;
      emailHash: string;
    }>;
    stats.users.total = users.length;

    for (const user of users) {
      try {
        const updates: Record<string, unknown> = {};
        let changed = false;

        // email 已加密则跳过；否则需要原始明文计算 hash + 加密
        if (user.email && !isEncrypted(user.email)) {
          const normalizedEmail = user.email.trim().toLowerCase();
          updates.emailHash = await hmacHash(normalizedEmail, key);
          updates.email = await encrypt(normalizedEmail, key);
          changed = true;
        } else if (!user.emailHash || user.emailHash === '') {
          // email 已加密但 emailHash 缺失：无法回填（无明文），跳过
          // 这种情况理论上不应发生
        }

        if (!changed) {
          stats.users.skipped++;
          continue;
        }

        await db.update(schema.users)
          .set(updates)
          .where(eq(schema.users.id, user.id))
          .run();
        stats.users.encrypted++;
      } catch {
        stats.users.errors++;
      }
    }
  } catch {
    stats.users.errors++;
  }

  // 2. 订阅表：加密所有敏感字段
  try {
    const subs = (await db.select().from(schema.subscriptions).all() as unknown) as Array<{
      id: string;
      name: string;
      description: string | null;
      icon: string | null;
      amount: string | null;
      currency: string | null;
      renewalPeriod: string | null;
      expireDate: string;
      reminderDays: string | null;
    }>;
    stats.subscriptions.total = subs.length;

    for (const sub of subs) {
      try {
        const updates: Record<string, unknown> = {};
        let changed = false;

        if (sub.name && !isEncrypted(sub.name)) {
          updates.name = await encrypt(sub.name, key);
          changed = true;
        }
        if (sub.description && !isEncrypted(sub.description)) {
          updates.description = await encrypt(sub.description, key);
          changed = true;
        }
        if (sub.icon && !isEncrypted(sub.icon)) {
          updates.icon = await encrypt(sub.icon, key);
          changed = true;
        }
        if (sub.amount !== null && sub.amount !== undefined && sub.amount !== '' && !isEncrypted(String(sub.amount))) {
          updates.amount = await encrypt(String(sub.amount), key);
          changed = true;
        }
        if (sub.currency && !isEncrypted(sub.currency)) {
          updates.currency = await encrypt(sub.currency, key);
          changed = true;
        }
        if (sub.renewalPeriod && !isEncrypted(sub.renewalPeriod)) {
          updates.renewalPeriod = await encrypt(sub.renewalPeriod, key);
          changed = true;
        }
        if (sub.expireDate && !isEncrypted(sub.expireDate)) {
          updates.expireDate = await encrypt(sub.expireDate, key);
          changed = true;
        }
        if (sub.reminderDays && !isEncrypted(sub.reminderDays)) {
          updates.reminderDays = await encrypt(sub.reminderDays, key);
          changed = true;
        }

        if (!changed) {
          stats.subscriptions.skipped++;
          continue;
        }

        await db.update(schema.subscriptions)
          .set(updates)
          .where(eq(schema.subscriptions.id, sub.id))
          .run();
        stats.subscriptions.encrypted++;
      } catch {
        stats.subscriptions.errors++;
      }
    }
  } catch {
    stats.subscriptions.errors++;
  }

  // 3. 分组表：加密 name/color/icon
  try {
    const groups = (await db.select().from(schema.groups).all() as unknown) as Array<{
      id: string;
      name: string;
      color: string | null;
      icon: string | null;
    }>;
    stats.groups.total = groups.length;

    for (const group of groups) {
      try {
        const updates: Record<string, unknown> = {};
        let changed = false;

        if (group.name && !isEncrypted(group.name)) {
          updates.name = await encrypt(group.name, key);
          changed = true;
        }
        if (group.color && !isEncrypted(group.color)) {
          updates.color = await encrypt(group.color, key);
          changed = true;
        }
        if (group.icon && !isEncrypted(group.icon)) {
          updates.icon = await encrypt(group.icon, key);
          changed = true;
        }

        if (!changed) {
          stats.groups.skipped++;
          continue;
        }

        await db.update(schema.groups)
          .set(updates)
          .where(eq(schema.groups.id, group.id))
          .run();
        stats.groups.encrypted++;
      } catch {
        stats.groups.errors++;
      }
    }
  } catch {
    stats.groups.errors++;
  }

  // 4. 通知渠道表：加密 name（config 由 encrypt-channels 处理，此处仅处理 name）
  try {
    const channels = (await db.select().from(schema.notificationChannels).all() as unknown) as Array<{
      id: string;
      name: string;
      config: string;
    }>;
    stats.channels.total = channels.length;

    for (const channel of channels) {
      try {
        const updates: Record<string, unknown> = {};
        let changed = false;

        if (channel.name && !isEncrypted(channel.name)) {
          updates.name = await encrypt(channel.name, key);
          changed = true;
        }
        if (channel.config && !isEncrypted(channel.config)) {
          updates.config = await encrypt(channel.config, key);
          changed = true;
        }

        if (!changed) {
          stats.channels.skipped++;
          continue;
        }

        await db.update(schema.notificationChannels)
          .set(updates)
          .where(eq(schema.notificationChannels.id, channel.id))
          .run();
        stats.channels.encrypted++;
      } catch {
        stats.channels.errors++;
      }
    }
  } catch {
    stats.channels.errors++;
  }

  // 5. 通知日志表：加密 errorMessage
  try {
    const logs = (await db.select().from(schema.notificationLogs).all() as unknown) as Array<{
      id: string;
      errorMessage: string | null;
    }>;
    stats.logs.total = logs.length;

    for (const log of logs) {
      try {
        if (!log.errorMessage || isEncrypted(log.errorMessage)) {
          stats.logs.skipped++;
          continue;
        }

        const encryptedError = await encrypt(log.errorMessage, key);
        await db.update(schema.notificationLogs)
          .set({ errorMessage: encryptedError })
          .where(eq(schema.notificationLogs.id, log.id))
          .run();
        stats.logs.encrypted++;
      } catch {
        stats.logs.errors++;
      }
    }
  } catch {
    stats.logs.errors++;
  }

  return c.json<ApiResponse>({ success: true, data: stats });
});

export default migrate;
