import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, and } from 'drizzle-orm'
import type { CreateSubscriptionRequest, UpdateSubscriptionRequest, Stats } from '../types'
import {
  encrypt,
  decryptField,
  MIN_ENCRYPTION_KEY_LENGTH
} from './crypto'
import { getDaysUntilExpire, getExpireStatus } from './date'

type SubscriptionRow = {
  id: string
  name: string
  description: string | null
  icon: string | null
  amount: string | null
  currency: string | null
  renewalPeriod: string | null
  expireDate: string
  reminderDays: string | null
  groupId: string | null
  userId: string
  createdAt: Date | null
  updatedAt: Date | null
}

type GroupRow = {
  id: string
  name: string
  color: string | null
  icon: string | null
  sortOrder: number | null
  userId: string
  createdAt: Date | null
}

type ChannelRow = {
  id: string
  type: string
  name: string
  config: string
  enabled: number | null
  userId: string
  createdAt: Date | null
}

export class SubscriptionService {
  constructor(
    private db: ReturnType<typeof drizzle<typeof schema>>,
    private encryptionKey?: string
  ) {}

  private validateEncryptionKey(): string {
    if (!this.encryptionKey || this.encryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
      throw new Error('Encryption key is missing or too short')
    }
    return this.encryptionKey
  }

  /**
   * 解密单条订阅记录的字段
   */
  private async decryptRecord(record: SubscriptionRow): Promise<void> {
    if (!record) return
    const key = this.validateEncryptionKey()
    record.name = (await decryptField(record.name, key)) ?? ''
    record.description = await decryptField(record.description, key)
    record.icon = await decryptField(record.icon, key)
    record.amount = await decryptField(record.amount, key)
    record.currency = await decryptField(record.currency, key)
    record.renewalPeriod = await decryptField(record.renewalPeriod, key)
    // 解密失败时返回空字符串，避免把加密密文泄漏到前端导致显示异常（如 Infinity 天）
    record.expireDate = (await decryptField(record.expireDate, key)) ?? ''
    record.reminderDays = await decryptField(record.reminderDays, key)
  }

  /**
   * 加密创建/更新时的字段值
   */
  private async encryptUpdateFields(updates: Record<string, unknown>): Promise<Record<string, unknown>> {
    const key = this.validateEncryptionKey()
    const result: Record<string, unknown> = { ...updates }

    if (result.name !== undefined) {
      result.name = await encrypt(String(result.name), key)
    }
    if (result.description !== undefined && result.description !== null && result.description !== '') {
      result.description = await encrypt(String(result.description), key)
    }
    if (result.icon !== undefined && result.icon !== null && result.icon !== '') {
      result.icon = await encrypt(String(result.icon), key)
    }
    if (result.amount !== undefined && result.amount !== null && result.amount !== '') {
      result.amount = await encrypt(String(result.amount), key)
    }
    if (result.currency !== undefined && result.currency !== null && result.currency !== '') {
      result.currency = await encrypt(String(result.currency), key)
    }
    if (result.renewalPeriod !== undefined && result.renewalPeriod !== null && result.renewalPeriod !== '') {
      result.renewalPeriod = await encrypt(String(result.renewalPeriod), key)
    }
    if (result.expireDate !== undefined) {
      result.expireDate = await encrypt(String(result.expireDate), key)
    }
    if (result.reminderDays !== undefined && result.reminderDays !== null && result.reminderDays !== '') {
      result.reminderDays = await encrypt(String(result.reminderDays), key)
    }

    return result
  }

  async getAll(userId: string): Promise<SubscriptionRow[]> {
    const rows = (await this.db.select().from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, userId))
      .all()) as unknown as SubscriptionRow[]
    for (const row of rows) {
      await this.decryptRecord(row)
    }
    return rows
  }

  async getById(id: string, userId: string): Promise<SubscriptionRow | undefined> {
    const results = (await this.db.select().from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.userId, userId)))
      .all()) as unknown as SubscriptionRow[]
    const row = results[0]
    if (row) {
      await this.decryptRecord(row)
    }
    return row
  }

  async getByGroup(groupId: string, userId: string): Promise<SubscriptionRow[]> {
    const rows = (await this.db.select().from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.groupId, groupId), eq(schema.subscriptions.userId, userId)))
      .all()) as unknown as SubscriptionRow[]
    for (const row of rows) {
      await this.decryptRecord(row)
    }
    return rows
  }

  async create(userId: string, data: CreateSubscriptionRequest): Promise<SubscriptionRow | undefined> {
    const id = crypto.randomUUID()
    const key = this.validateEncryptionKey()

    const reminderDaysStr = String(data.reminderDays ?? 7)

    // 加密所有敏感字段
    const encryptedName = await encrypt(data.name, key)
    const encryptedDescription = data.description ? await encrypt(data.description, key) : null
    const encryptedIcon = data.icon ? await encrypt(data.icon, key) : null
    const encryptedAmount = data.amount !== undefined && data.amount !== null
      ? await encrypt(String(data.amount), key)
      : null
    const encryptedCurrency = await encrypt(data.currency || 'CNY', key)
    const encryptedRenewalPeriod = await encrypt(data.renewalPeriod || 'monthly', key)
    const encryptedExpireDate = await encrypt(data.expireDate, key)
    const encryptedReminderDays = await encrypt(reminderDaysStr, key)

    await this.db.insert(schema.subscriptions).values({
      id,
      name: encryptedName,
      description: encryptedDescription,
      icon: encryptedIcon,
      amount: encryptedAmount,
      currency: encryptedCurrency,
      renewalPeriod: encryptedRenewalPeriod,
      expireDate: encryptedExpireDate,
      reminderDays: encryptedReminderDays,
      groupId: data.groupId || null,
      userId
    }).run()

    return this.getById(id, userId)
  }

  async update(id: string, userId: string, data: UpdateSubscriptionRequest): Promise<SubscriptionRow | undefined> {
    const rawUpdates: Record<string, unknown> = { updatedAt: new Date() }

    if (data.name !== undefined) rawUpdates.name = data.name
    if (data.description !== undefined) rawUpdates.description = data.description
    if (data.icon !== undefined) rawUpdates.icon = data.icon
    if (data.amount !== undefined) rawUpdates.amount = data.amount === null ? null : String(data.amount)
    if (data.currency !== undefined) rawUpdates.currency = data.currency
    if (data.renewalPeriod !== undefined) rawUpdates.renewalPeriod = data.renewalPeriod
    if (data.expireDate !== undefined) rawUpdates.expireDate = data.expireDate
    if (data.reminderDays !== undefined) rawUpdates.reminderDays = String(data.reminderDays)
    if (data.groupId !== undefined) rawUpdates.groupId = data.groupId

    const encryptedUpdates = await this.encryptUpdateFields(rawUpdates)

    await this.db.update(schema.subscriptions)
      .set(encryptedUpdates)
      .where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.userId, userId)))
      .run()

    return this.getById(id, userId)
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.db.delete(schema.subscriptions)
      .where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.userId, userId)))
      .run()
  }

  /**
   * 获取即将到期的订阅
   * 由于 expireDate 已加密，无法用 SQL 范围查询，改为应用层过滤：
   * 1. 按 userId 取该用户全部订阅（数据量有限）
   * 2. 解密 expireDate
   * 3. 用 getDaysUntilExpire 计算剩余天数（支持周期模式 R:MM-DD 和非周期 YYYY-MM-DD）
   * 4. 过滤出 0 <= 剩余天数 <= days 的订阅
   */
  async getExpiringSoon(userId: string, days: number = 7): Promise<SubscriptionRow[]> {
    const all = await this.getAll(userId)
    return all.filter((sub) => {
      if (!sub.expireDate) return false
      const remaining = getDaysUntilExpire(sub.expireDate)
      // 剩余天数在 0 到 days 之间（含今天到期）
      return remaining >= 0 && remaining <= days
    })
  }

  /**
   * 获取统计数据
   * 由于敏感字段已加密，统计改为应用层计算（按 userId 取全部后过滤）
   * 支持周期模式（R:MM-DD）和非周期模式（YYYY-MM-DD）
   */
  async getStats(userId: string): Promise<Stats> {
    const all = await this.getAll(userId)

    let expiring7Days = 0
    let expired = 0
    let expiringThisMonth = 0

    for (const sub of all) {
      if (!sub.expireDate) continue
      const days = getDaysUntilExpire(sub.expireDate)
      const status = getExpireStatus(sub.expireDate)

      // 已过期（非周期模式且日期已过）
      if (status === 'expired') {
        expired++
      }
      // 7 天内到期（含今天）
      if (days >= 0 && days <= 7) {
        expiring7Days++
      }
      // 本月内到期（30 天内）
      if (days >= 0 && days <= 30) {
        expiringThisMonth++
      }
    }

    const totalGroupsArr = (await this.db.select().from(schema.groups)
      .where(eq(schema.groups.userId, userId)).all()) as unknown as GroupRow[]
    const totalChannelsArr = (await this.db.select().from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.userId, userId)).all()) as unknown as ChannelRow[]

    return {
      totalSubscriptions: all.length,
      expiringThisMonth,
      expiringWithin7Days: expiring7Days,
      expired,
      totalGroups: totalGroupsArr.length,
      totalChannels: totalChannelsArr.length
    }
  }
}

export function createSubscriptionService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey?: string
): SubscriptionService {
  return new SubscriptionService(db, encryptionKey)
}
