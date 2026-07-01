import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, and } from 'drizzle-orm'
import type { CreateSubscriptionRequest, UpdateSubscriptionRequest, Stats, ExtendMode } from '../types'
import {
  encrypt,
  encryptJSON,
  decryptField,
  decryptJSON,
  isEncrypted,
  MIN_ENCRYPTION_KEY_LENGTH
} from './crypto'
import { getDaysUntilExpire, getExpireStatus, isRecurring, getRecurringMonthDay } from './date'
import { createNotificationService } from './notification'

const RECURRING_PREFIX = 'R:'

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
 * 将日期对象转为 YYYY-MM-DD 存储值（非周期模式，保留年份）
 */
function dateToISOValue(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * 将日期对象转为 R:YYYY-MM-DD 存储值（周期模式续期后，保留年份）
 */
function dateToRecurringISOValue(d: Date): string {
  return `${RECURRING_PREFIX}${dateToISOValue(d)}`
}

/**
 * 判断周期模式是否包含年份（R:YYYY-MM-DD）
 */
function isRecurringWithYear(expireDate: string): boolean {
  return isRecurring(expireDate) && expireDate.slice(RECURRING_PREFIX.length).length === 10
}

/**
 * 获取周期模式的基准到期日（用于 "以到期日延续" 模式）
 * - R:MM-DD：滚动到距今最近的未来日期
 * - R:YYYY-MM-DD：使用显式日期（若已过期则用今天）
 */
function getRecurringBaseDate(expireDate: string): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // R:YYYY-MM-DD：使用显式日期
  if (isRecurringWithYear(expireDate)) {
    const parsed = new Date(expireDate.slice(RECURRING_PREFIX.length))
    parsed.setHours(0, 0, 0, 0)
    if (!isNaN(parsed.getTime()) && parsed.getTime() >= today.getTime()) {
      return parsed
    }
    return today
  }

  // R:MM-DD：滚动到最近的未来日期
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
   * 支持周期模式（R:MM-DD / R:YYYY-MM-DD）和非周期模式（YYYY-MM-DD）。计算规则：
   * - extendMode='expire'：基准日 = 当前到期日
   *   - 周期 R:MM-DD：滚动到下一次到期日
   *   - 周期 R:YYYY-MM-DD / 非周期：使用显式日期（已过期则用今天）
   * - extendMode='current'：基准日 = 今天
   * 延续天数：yearly=365，monthly=30，custom=customRenewalDays
   * 存储格式：周期模式 → R:YYYY-MM-DD（保留年份仍被识别为周期模式），非周期模式 → YYYY-MM-DD
   */
  async extend(id: string, userId: string): Promise<SubscriptionRow | undefined> {
    const sub = await this.getById(id, userId)
    if (!sub) return undefined

    const extendMode = (sub.extendMode === 'current' ? 'current' : 'expire') as ExtendMode
    const days = getExtendDays(sub.renewalPeriod, sub.customRenewalDays)
    const recurring = isRecurring(sub.expireDate)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let baseDate: Date
    if (extendMode === 'current') {
      baseDate = today
    } else if (recurring) {
      // 周期模式（R:MM-DD 或 R:YYYY-MM-DD）
      baseDate = getRecurringBaseDate(sub.expireDate)
    } else {
      // 非周期模式：以当前到期日为基准，若已过期则用今天
      const parsed = new Date(sub.expireDate)
      parsed.setHours(0, 0, 0, 0)
      baseDate = !isNaN(parsed.getTime()) && parsed.getTime() >= today.getTime() ? parsed : today
    }

    const newDate = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000)
    // 周期模式存为 R:YYYY-MM-DD（保留年份 + R: 前缀），非周期存为 YYYY-MM-DD
    const newExpireDate = recurring ? dateToRecurringISOValue(newDate) : dateToISOValue(newDate)

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
   * 恢复备份：从备份 JSON 导入数据
   * 模式：
   * - 'replace'：先清空当前用户的订阅、分组、通知渠道，再导入（默认）
   * - 'merge'：保留现有数据，仅追加备份中的数据（可能产生重复）
   *
   * 备份中的明文会被重新加密后写入数据库。
   * 分组 ID 会被重新映射，订阅的 groupId 也会同步更新。
   */
  async importData(
    userId: string,
    backup: {
      version?: number
      subscriptions?: any[]
      groups?: any[]
      channels?: any[]
    },
    mode: 'replace' | 'merge' = 'replace'
  ): Promise<{
    subscriptions: number
    groups: number
    channels: number
  }> {
    const key = this.validateEncryptionKey()

    const subs = Array.isArray(backup.subscriptions) ? backup.subscriptions : []
    const groups = Array.isArray(backup.groups) ? backup.groups : []
    const channels = Array.isArray(backup.channels) ? backup.channels : []

    // 限制单次导入数量，防止过大请求
    const MAX_IMPORT = 2000
    if (subs.length > MAX_IMPORT || groups.length > MAX_IMPORT || channels.length > MAX_IMPORT) {
      throw new Error(`Import data too large (max ${MAX_IMPORT} per category)`)
    }

    // replace 模式：先删除当前用户的所有数据（注意顺序，避免外键约束）
    if (mode === 'replace') {
      await this.db.delete(schema.subscriptions)
        .where(eq(schema.subscriptions.userId, userId)).run()
      await this.db.delete(schema.notificationChannels)
        .where(eq(schema.notificationChannels.userId, userId)).run()
      await this.db.delete(schema.groups)
        .where(eq(schema.groups.userId, userId)).run()
    }

    // 分组 ID 映射（旧 ID → 新 ID），用于同步订阅的 groupId
    const groupIdMap = new Map<string, string>()

    // 导入分组
    for (const g of groups) {
      if (!g || typeof g.name !== 'string' || !g.name) continue
      const newId = crypto.randomUUID()
      if (typeof g.id === 'string') {
        groupIdMap.set(g.id, newId)
      }
      const encryptedName = await encrypt(String(g.name).slice(0, 200), key)
      const color = typeof g.color === 'string' ? g.color : '#6366F1'
      const encryptedColor = color ? await encrypt(color, key) : '#6366F1'
      const icon = typeof g.icon === 'string' && g.icon ? await encrypt(g.icon.slice(0, 16), key) : null
      const sortOrder = Number(g.sortOrder) || 0

      await this.db.insert(schema.groups).values({
        id: newId,
        name: encryptedName,
        color: encryptedColor,
        icon,
        sortOrder,
        userId
      }).run()
    }

    // 导入订阅
    let importedSubs = 0
    for (const s of subs) {
      if (!s || typeof s.name !== 'string' || !s.name) continue
      const id = crypto.randomUUID()

      const encryptedName = await encrypt(String(s.name).slice(0, 200), key)
      const description = typeof s.description === 'string' && s.description
        ? await encrypt(String(s.description).slice(0, 500), key)
        : null
      const icon = typeof s.icon === 'string' && s.icon
        ? await encrypt(String(s.icon).slice(0, 16), key)
        : null
      const amountVal = s.amount !== undefined && s.amount !== null && s.amount !== ''
        ? String(s.amount)
        : null
      const encryptedAmount = amountVal ? await encrypt(amountVal, key) : null
      const currency = typeof s.currency === 'string' && s.currency ? s.currency : 'CNY'
      const encryptedCurrency = await encrypt(currency, key)
      const renewalPeriod = typeof s.renewalPeriod === 'string' && s.renewalPeriod
        ? s.renewalPeriod
        : 'monthly'
      const encryptedRenewalPeriod = await encrypt(renewalPeriod, key)
      const expireDate = typeof s.expireDate === 'string' && s.expireDate ? s.expireDate : dateToISOValue(new Date())
      const encryptedExpireDate = await encrypt(expireDate, key)
      const reminderDays = Number(s.reminderDays) || 7
      const encryptedReminderDays = await encrypt(String(reminderDays), key)
      const extendMode = typeof s.extendMode === 'string' && s.extendMode ? s.extendMode : 'expire'
      const encryptedExtendMode = await encrypt(extendMode, key)
      const customRenewalDays = Number(s.customRenewalDays) || 30
      const encryptedCustomRenewalDays = await encrypt(String(customRenewalDays), key)

      // 重新映射 groupId
      let groupId: string | null = null
      if (typeof s.groupId === 'string' && s.groupId) {
        groupId = groupIdMap.get(s.groupId) ?? null
      }

      await this.db.insert(schema.subscriptions).values({
        id,
        name: encryptedName,
        description,
        icon,
        amount: encryptedAmount,
        currency: encryptedCurrency,
        renewalPeriod: encryptedRenewalPeriod,
        expireDate: encryptedExpireDate,
        reminderDays: encryptedReminderDays,
        extendMode: encryptedExtendMode,
        customRenewalDays: encryptedCustomRenewalDays,
        groupId,
        userId
      }).run()
      importedSubs++
    }

    // 导入通知渠道
    let importedChannels = 0
    for (const ch of channels) {
      if (!ch || typeof ch.type !== 'string' || !ch.type) continue
      if (typeof ch.name !== 'string' || !ch.name) continue

      const id = crypto.randomUUID()
      const encryptedName = await encrypt(String(ch.name).slice(0, 200), key)

      // config 为明文对象，需重新加密
      let configStr = '{}'
      if (ch.config && typeof ch.config === 'object') {
        const cfg: Record<string, string> = {}
        const cfgObj = ch.config as Record<string, unknown>
        for (const k of Object.keys(cfgObj).slice(0, 20)) {
          const v = cfgObj[k]
          if (typeof v === 'string') cfg[k] = v.slice(0, 8192)
        }
        configStr = await encryptJSON(cfg, key)
      } else if (typeof ch.config === 'string' && ch.config) {
        try {
          const parsed = JSON.parse(ch.config)
          configStr = await encryptJSON(parsed, key)
        } catch {
          configStr = await encrypt(ch.config, key)
        }
      }

      const enabled = ch.enabled === false || ch.enabled === 0 ? 0 : 1

      await this.db.insert(schema.notificationChannels).values({
        id,
        type: ch.type,
        name: encryptedName,
        config: configStr,
        enabled,
        userId
      }).run()
      importedChannels++
    }

    return {
      subscriptions: importedSubs,
      groups: groups.filter((g) => g && typeof g.name === 'string' && g.name).length,
      channels: importedChannels
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
