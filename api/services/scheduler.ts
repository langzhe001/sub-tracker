/**
 * 定时任务调度服务
 *
 * 由 Cloudflare Workers Cron Triggers 触发（参见 wrangler.toml [triggers].crons）。
 * 每天执行一次，扫描所有订阅：
 * 1. 解密到期日期和提醒天数
 * 2. 计算剩余天数 daysLeft
 * 3. 若 0 <= daysLeft <= reminderDays，且当日未发送过通知，则使用该订阅用户的所有启用渠道发送提醒
 * 4. 记录通知日志
 *
 * 由于敏感字段已加密，无法用 SQL 过滤，采用应用层全表遍历（数据量有限，可接受）。
 */

import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import { eq, and } from 'drizzle-orm';
import {
  decrypt,
  decryptJSON,
  isEncrypted,
  MIN_ENCRYPTION_KEY_LENGTH
} from './crypto';
import { getDaysUntilExpire } from './date';
import { createNotificationService } from './notification';
import type { Env } from '../types';

interface RawSubscription {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  amount: string | null;
  currency: string | null;
  renewalPeriod: string | null;
  expireDate: string;
  reminderDays: string | null;
  groupId: string | null;
  userId: string;
}

interface RawChannel {
  id: string;
  type: string;
  name: string;
  config: string;
  enabled: number | null;
  userId: string;
}

interface RawLog {
  id: string;
  sentAt: Date | null;
}

export class SchedulerService {
  constructor(
    private db: ReturnType<typeof drizzle<typeof schema>>,
    private encryptionKey: string
  ) {}

  private validateEncryptionKey(): string {
    if (!this.encryptionKey || this.encryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
      throw new Error('Encryption key is missing or too short');
    }
    return this.encryptionKey;
  }

  /**
   * 解密单个字段，失败返回 null
   */
  private async safeDecrypt(value: string | null | undefined): Promise<string | null> {
    if (!value) return null;
    if (!isEncrypted(value)) return value;
    try {
      return await decrypt(value, this.encryptionKey);
    } catch {
      return null;
    }
  }

  /**
   * 检查今日是否已为该订阅+渠道发送过通知
   */
  private async sentToday(subscriptionId: string, channelId: string): Promise<boolean> {
    const todayStr = new Date().toISOString().split('T')[0];
    const logs = (await this.db.select().from(schema.notificationLogs)
      .where(and(
        eq(schema.notificationLogs.subscriptionId, subscriptionId),
        eq(schema.notificationLogs.channelId, channelId)
      ))
      .all()) as unknown as RawLog[];

    return logs.some((log) => {
      if (!log.sentAt) return false;
      return new Date(log.sentAt).toISOString().split('T')[0] === todayStr;
    });
  }

  /**
   * 执行一次完整的扫描与通知发送
   * @returns 扫描统计
   */
  async run(): Promise<{
    totalSubscriptions: number;
    notified: number;
    skipped: number;
    errors: number;
  }> {
    this.validateEncryptionKey();
    const notificationService = createNotificationService(this.db, this.encryptionKey);

    const stats = { totalSubscriptions: 0, notified: 0, skipped: 0, errors: 0 };

    // 1. 取所有订阅（不分用户，cron 需覆盖全部）
    const subs = (await this.db.select().from(schema.subscriptions).all()) as unknown as RawSubscription[];
    stats.totalSubscriptions = subs.length;

    // 2. 取所有启用的通知渠道（按 userId 分组缓存，避免重复查询）
    const channelCache = new Map<string, RawChannel[]>();
    const allChannels = (await this.db.select().from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.enabled, 1))
      .all()) as unknown as RawChannel[];
    for (const ch of allChannels) {
      const list = channelCache.get(ch.userId) || [];
      list.push(ch);
      channelCache.set(ch.userId, list);
    }

    // 3. 逐条处理
    for (const sub of subs) {
      try {
        // 解密到期日期与提醒天数
        const expireDate = await this.safeDecrypt(sub.expireDate);
        if (!expireDate) {
          stats.skipped++;
          continue;
        }

        const reminderDaysStr = await this.safeDecrypt(sub.reminderDays);
        const reminderDays = Number(reminderDaysStr);
        if (isNaN(reminderDays) || reminderDays < 1) {
          stats.skipped++;
          continue;
        }

        const daysLeft = getDaysUntilExpire(expireDate);
        // 无效日期跳过
        if (daysLeft === Infinity) {
          stats.skipped++;
          continue;
        }
        // 仅在 0 <= daysLeft <= reminderDays 范围内提醒（含今天到期）
        if (daysLeft < 0 || daysLeft > reminderDays) {
          stats.skipped++;
          continue;
        }

        // 解密订阅字段以构造消息
        const decryptedSub = {
          ...sub,
          name: (await this.safeDecrypt(sub.name)) ?? sub.name,
          description: await this.safeDecrypt(sub.description),
          icon: await this.safeDecrypt(sub.icon),
          amount: await this.safeDecrypt(sub.amount),
          currency: await this.safeDecrypt(sub.currency),
          renewalPeriod: await this.safeDecrypt(sub.renewalPeriod),
          expireDate
        };

        // 取该用户启用的渠道
        const channels = channelCache.get(sub.userId) || [];
        if (channels.length === 0) {
          stats.skipped++;
          continue;
        }

        let sentAny = false;
        for (const channel of channels) {
          // 防重复：当日已发则跳过
          if (await this.sentToday(sub.id, channel.id)) {
            continue;
          }

          // 解密通道配置为对象（sendNotification 内部会再解密一次，这里保留原 config 字段）
          // notification.sendNotification 接受原始 config 字符串并自行解密
          const channelForSend = {
            ...channel,
            config: channel.config // 保留加密字符串，由 sendNotification 解密
          };

          const result = await notificationService.sendNotification(channelForSend, decryptedSub, daysLeft);
          await notificationService.logNotification(
            sub.id,
            channel.id,
            channel.type,
            result.success,
            result.error
          );
          if (result.success) {
            sentAny = true;
          }
        }

        if (sentAny) {
          stats.notified++;
        } else {
          stats.skipped++;
        }
      } catch (err) {
        console.error('scheduler: subscription processing failed:', sub.id, err instanceof Error ? err.message : String(err));
        stats.errors++;
      }
    }

    return stats;
  }
}

export function createSchedulerService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey: string
): SchedulerService {
  return new SchedulerService(db, encryptionKey);
}

/**
 * Cron 触发器入口，供 index.ts 的 scheduled handler 调用
 */
export async function runScheduledJob(env: Env): Promise<void> {
  if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY.length < MIN_ENCRYPTION_KEY_LENGTH) {
    console.error('scheduler: encryption key not configured, abort');
    return;
  }
  const db = drizzle(env.DB!, { schema });
  const service = createSchedulerService(db, env.ENCRYPTION_KEY);
  const stats = await service.run();
  console.log('scheduler done:', JSON.stringify(stats));
}
