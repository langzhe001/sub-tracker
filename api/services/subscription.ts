import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, and } from 'drizzle-orm'
import type { CreateSubscriptionRequest, UpdateSubscriptionRequest, Stats, ExtendMode } from '../types'
import {
  encrypt,
  decryptField,
  decryptJSON,
  isEncrypted,
  MIN_ENCRYPTION_KEY_LENGTH
} from './crypto'
import { getDaysUntilExpire, getExpireStatus, isRecurring, getRecurringMonthDay } from './date'
import { createNotificationService } from './notification'

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
  extendMode: string | null
  customRenewalDays: string | null
  groupId: string | null
  userId: string
  createdAt: Date | null
  updatedAt: Date | null
}

/**
 * 根据续费周期换算延续天数
 * - yearly: 365 天
 * - monthly: 30 天
 * - custom: 使用 customRenewalDays（默认 30）
 */
function getExtendDays(renewalPeriod: string | null, customRenewalDays: string | null): number {
  if (renewalPeriod === 'yearly') return 365
  if (renewalPeriod === 'monthly') return 30
  // custom
  const days = Number(customRenewalDays)
  if (!isNaN(days) && days > 0) return days
  return 30
}

/**
 * 将日期对象转为 YYYY-MM-DD 存储值（保留年份，用于续期后的到期日）
 */
function dateToISOValue(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * 将周期模式 R:MM-DD 滚动到距今最近的未来日期
 * 用于 "以到期日延续" 模式：取下一次到期日作为基准
 */
function getRecurringNextDate(expireDate: string): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const md = getRecurringMonthDay(expireDate)
  const [monthStr, dayStr] = md.split('-')
  const month = Number(monthStr) - 1
  const day = Number(dayStr)
  let target = new Date(today.getFullYear(), month, day)
  target.setHours(0, 0, 0, 0)
  if (target.getTime() < today.getTime()) {
    target = new Date(today.getFullYear() + 1, month, day)
    target.setHours(0, 0, 0, 0)
  }
  return target
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
    // extendMode 可能为 null（旧数据）或明文（默认值），decryptField 会原样返回未加密值
    record.extendMode = (await decryptField(record.extendMode, key)) ?? 'expire'
    record.customRenewalDays = (await decryptField(record.customRenewalDays, key)) ?? '30'
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
    if (result.extendMode !== undefined && result.extendMode !== null && result.extendMode !== '') {
      result.extendMode = await encrypt(String(result.extendMode), key)
    }
    if (result.customRenewalDays !== undefined && result.customRenewalDays !== null && result.customRenewalDays !== '') {
      result.customRenewalDays = await encrypt(String(result.customRenewalDays), key)
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
    const extendModeVal = data.extendMode || 'expire'
    const customRenewalDaysStr = String(data.customRenewalDays ?? 30)

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
    const encryptedExtendMode = await encrypt(extendModeVal, key)
    const encryptedCustomRenewalDays = await encrypt(customRenewalDaysStr, key)

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
      extendMode: encryptedExtendMode,
      customRenewalDays: encryptedCustomRenewalDays,
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
    if (data.extendMode !== undefined) rawUpdates.extendMode = data.extendMode
    if (data.customRenewalDays !== undefined) rawUpdates.customRenewalDays = String(data.customRenewalDays)
    if (data.groupId !== undefined) rawUpdates.groupId = data.groupId

    const encryptedUpdates = await this.encryptUpdateFields(rawUpdates)

    await this.db.update(schema.subscriptions)
      .set(encryptedUpdates)
      .where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.userId, userId)))
      .run()

    return this.getById(id, userId)
  }

  /**
   * 一键续期：按订阅的 extendMode 与 renewalPeriod 推后到期日期
   *
   * 支持周期模式（R:MM-DD）和非周期模式（YYYY-MM-DD）。计算规则：
   * - extendMode='expire'：基准日 = 当前到期日（周期模式滚动到未来；非周期若已过期则用今天）
   * - extendMode='current'：基准日 = 今天
   * 延续天数：yearly=365，monthly=30，custom=customRenewalDays
   * 计算后存储为 YYYY-MM-DD（保留年份），确保剩余天数计算正确
   */
  async extend(id: string, userId: string): Promise<SubscriptionRow | undefined> {
    const sub = await this.getById(id, userId)
    if (!sub) return undefined

    const extendMode = (sub.extendMode === 'current' ? 'current' : 'expire') as ExtendMode
    const days = getExtendDays(sub.renewalPeriod, sub.customRenewalDays)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let baseDate: Date
    if (extendMode === 'current') {
      // 以当前日期为基准
      baseDate = today
    } else if (isRecurring(sub.expireDate)) {
      // 周期模式：滚动到下一次到期日作为基准
      baseDate = getRecurringNextDate(sub.expireDate)
    } else {
      // 非周期模式：以当前到期日为基准，若已过期则用今天
      const parsed = new Date(sub.expireDate)
      parsed.setHours(0, 0, 0, 0)
      baseDate = !isNaN(parsed.getTime()) && parsed.getTime() >= today.getTime() ? parsed : today
    }

    const newDate = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000)
    // 保留年份，存为 YYYY-MM-DD，避免 getDaysUntilExpire 再次滚动导致续期失效
    const newExpireDate = dateToISOValue(newDate)

    return this.update(id, userId, { expireDate: newExpireDate })
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.db.delete(schema.subscriptions)
      .where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.userId, userId)))
      .run()
  }

  /**
   * 导出用户全部数据（备份）：订阅、分组、通知渠道
   * 所有字段已解密，返回明文 JSON 结构
   */
  async exportData(userId: string): Promise<{
    exportedAt: string
    version: number
    subscriptions: any[]
    groups: any[]
    channels: any[]
  }> {
    const key = this.validateEncryptionKey()

    // 订阅
    const subs = await this.getAll(userId)
    const subscriptions = subs.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      icon: s.icon ?? '',
      amount: s.amount !== null && s.amount !== undefined && s.amount !== '' ? Number(s.amount) : null,
      currency: s.currency ?? 'CNY',
      renewalPeriod: s.renewalPeriod ?? 'monthly',
      expireDate: s.expireDate,
      reminderDays: Number(s.reminderDays) || 7,
      extendMode: s.extendMode ?? 'expire',
      customRenewalDays: Number(s.customRenewalDays) || 30,
      groupId: s.groupId ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }))

    // 分组（name 加密存储）
    const groupRows = (await this.db.select().from(schema.groups)
      .where(eq(schema.groups.userId, userId))
      .all()) as unknown as GroupRow[]
    const groups = []
    for (const g of groupRows) {
      groups.push({
        id: g.id,
        name: (await decryptField(g.name, key)) ?? g.name,
        color: g.color ?? '#6366F1',
        icon: g.icon ?? '',
        sortOrder: g.sortOrder ?? 0,
        createdAt: g.createdAt
      })
    }

    // 通知渠道（name + config 加密存储）
    const channelRows = (await this.db.select().from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.userId, userId))
      .all()) as unknown as ChannelRow[]
    const channels = []
    for (const ch of channelRows) {
      const name = (await decryptField(ch.name, key)) ?? ch.name
      let config: Record<string, string> = {}
      if (ch.config) {
        // 解析渠道配置
        if (isEncrypted(ch.config)) {
          try {
            config = await decryptJSON<Record<string, string>>(ch.config, key)
          } catch {
            config = {}
          }
        } else {
          try {
            config = JSON.parse(ch.config) as Record<string, string>
          } catch {
            config = {}
          }
        }
      }
      channels.push({
        id: ch.id,
        type: ch.type,
        name,
        config,
        enabled: ch.enabled === 1,
        createdAt: ch.createdAt
      })
    }

    return {
      exportedAt: new Date().toISOString(),
      version: 1,
      subscriptions,
      groups,
      channels
    }
  }

  /**
   * 测试推送：使用订阅真实数据向该用户所有启用的通知渠道发送一条测试通知
   * 返回每个渠道的发送结果
   */
  async testPush(id: string, userId: string): Promise<{
    results: Array<{ channelName: string; channelType: string; success: boolean; error?: string }>
    total: number
    success: number
    failed: number
  }> {
    const sub = await this.getById(id, userId)
    if (!sub) {
      return { results: [], total: 0, success: 0, failed: 0 }
    }

    // 取该用户所有启用的渠道
    const channels = (await this.db.select().from(schema.notificationChannels)
      .where(and(
        eq(schema.notificationChannels.userId, userId),
        eq(schema.notificationChannels.enabled, 1)
      ))
      .all()) as unknown as ChannelRow[]

    // 解密渠道 name（用于结果展示）
    const key = this.validateEncryptionKey()
    for (const ch of channels) {
      ch.name = (await decryptField(ch.name, key)) ?? ch.name
    }

    const notificationService = createNotificationService(this.db, this.encryptionKey)
    const daysLeft = getDaysUntilExpire(sub.expireDate)

    const results: Array<{ channelName: string; channelType: string; success: boolean; error?: string }> = []
    let success = 0
    let failed = 0

    for (const ch of channels) {
      const channelForSend = {
        ...ch,
        config: ch.config
      }
      const result = await notificationService.sendNotification(channelForSend, sub, daysLeft)
      if (result.success) {
        success++
      } else {
        failed++
      }
      results.push({
        channelName: ch.name,
        channelType: ch.type,
        success: result.success,
        error: result.error
      })
    }

    return { results, total: channels.length, success, failed }
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
