import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import type { ChannelType } from '../types'
import {
  encrypt,
  decryptField,
  decryptJSON,
  isEncrypted,
  MIN_ENCRYPTION_KEY_LENGTH
} from './crypto'
import { isRecurring, getRecurringMonthDay } from './date'

export class NotificationService {
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
   * 解密通道配置
   * 兼容已加密和未加密的数据
   */
  private async decryptChannelConfig(configStr: string): Promise<Record<string, string>> {
    if (!configStr) {
      return {}
    }

    // 如果不是加密格式，直接解析 JSON（兼容旧数据）
    if (!isEncrypted(configStr)) {
      try {
        return JSON.parse(configStr) as Record<string, string>
      } catch {
        return {}
      }
    }

    // 解密
    try {
      const key = this.validateEncryptionKey()
      return await decryptJSON<Record<string, string>>(configStr, key)
    } catch {
      return {}
    }
  }

  async sendNotification(
    channel: any,
    subscription: any,
    daysLeft: number
  ): Promise<{ success: boolean; error?: string }> {
    // 解密配置（如果已加密）
    const config = await this.decryptChannelConfig(channel.config as string)
    const message = this.buildMessage(subscription, daysLeft)

    try {
      switch (channel.type as ChannelType) {
        case 'email':
          return await this.sendEmail(config, subscription, message)
        case 'telegram':
          return await this.sendTelegram(config, message)
        case 'feishu':
          return await this.sendFeishu(config, message)
        case 'wechat':
          return await this.sendWechat(config, message)
        case 'notifyx':
          return await this.sendNotifyX(config, message)
        default:
          return { success: false, error: 'Unknown channel type' }
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  /**
   * 格式化到期日期为中文显示
   * - 周期模式 R:MM-DD → "每年 X月Y日"
   * - 非周期模式 YYYY-MM-DD → "YYYY年X月Y日"
   */
  private formatExpireDate(expireDate: string): string {
    if (!expireDate) return '未设置'
    if (isRecurring(expireDate)) {
      const md = getRecurringMonthDay(expireDate)
      const [m, d] = md.split('-')
      return `每年 ${Number(m)}月${Number(d)}日`
    }
    const date = new Date(expireDate)
    if (isNaN(date.getTime())) return expireDate
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
  }

  /**
   * 货币代码转符号
   */
  private currencySymbol(currency: string): string {
    switch ((currency || '').toUpperCase()) {
      case 'USD': return '$'
      case 'EUR': return '€'
      case 'CNY': return '¥'
      default: return currency || ''
    }
  }

  /**
   * 续费周期转中文
   */
  private periodLabel(period: string): string {
    switch (period) {
      case 'monthly': return '月'
      case 'yearly': return '年'
      case 'custom': return '周期'
      default: return period || ''
    }
  }

  /**
   * 构造推送消息，包含订阅填写的全部内容
   * 仅展示有值的字段，保持排版美观
   */
  private buildMessage(subscription: any, daysLeft: number): string {
    const status = daysLeft < 0
      ? '已过期'
      : daysLeft === 0
        ? '今天到期'
        : `还有 ${daysLeft} 天到期`

    const lines: string[] = ['📅 订阅到期提醒', '']

    if (subscription.name) {
      lines.push(`📌 名称：${subscription.name}`)
    }
    if (subscription.description) {
      lines.push(`📝 描述：${subscription.description}`)
    }
    // 费用（金额 + 货币 + 周期）
    if (subscription.amount !== undefined && subscription.amount !== null && subscription.amount !== '') {
      const amount = Number(subscription.amount)
      const symbol = this.currencySymbol(subscription.currency)
      const period = this.periodLabel(subscription.renewalPeriod)
      if (!isNaN(amount) && period) {
        lines.push(`💰 费用：${symbol}${amount.toFixed(2)} / ${period}`)
      } else if (!isNaN(amount)) {
        lines.push(`💰 费用：${symbol}${amount.toFixed(2)}`)
      }
    }
    // 到期日期
    if (subscription.expireDate) {
      lines.push(`📅 到期：${this.formatExpireDate(subscription.expireDate)}`)
    }
    // 状态
    lines.push(`⏰ 状态：${status}`)
    // 提醒设置
    if (subscription.reminderDays !== undefined && subscription.reminderDays !== null && subscription.reminderDays !== '') {
      const days = Number(subscription.reminderDays)
      if (!isNaN(days) && days > 0) {
        lines.push(`🔔 提前提醒：${days} 天`)
      }
    }

    lines.push('', '💡 请及时续费以避免服务中断')
    return lines.join('\n')
  }

  private async sendEmail(config: Record<string, string>, subscription: any, message: string): Promise<{ success: boolean; error?: string }> {
    const { smtpServer, smtpPort, email, password, toEmail } = config
    if (!smtpServer || !email || !toEmail) {
      return { success: false, error: '邮件配置不完整（SMTP 服务器、邮箱、收件人为必填项）' }
    }
    // Cloudflare Workers 不支持原生 SMTP，需通过外部邮件 API 服务（如 Resend、Mailgun）转发
    return { success: false, error: '当前环境暂不支持 SMTP 直发测试，请使用 Telegram/飞书/企业微信/NotifyX 渠道测试' }
  }

  private async sendTelegram(config: Record<string, string>, message: string): Promise<{ success: boolean; error?: string }> {
    const { botToken, chatId } = config
    if (!botToken || !chatId) {
      return { success: false, error: 'Missing Telegram credentials' }
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message })
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error: this.sanitizeErrorMessage(error) }
    }

    return { success: true }
  }

  private async sendFeishu(config: Record<string, string>, message: string): Promise<{ success: boolean; error?: string }> {
    const { webhookUrl } = config
    if (!webhookUrl) {
      return { success: false, error: 'Missing Feishu webhook URL' }
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: message } })
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error: this.sanitizeErrorMessage(error) }
    }

    return { success: true }
  }

  private async sendWechat(config: Record<string, string>, message: string): Promise<{ success: boolean; error?: string }> {
    const { webhookUrl } = config
    if (!webhookUrl) {
      return { success: false, error: 'Missing WeChat webhook URL' }
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: message } })
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error: this.sanitizeErrorMessage(error) }
    }

    return { success: true }
  }

  private async sendNotifyX(config: Record<string, string>, message: string): Promise<{ success: boolean; error?: string }> {
    const { apiKey } = config
    if (!apiKey) {
      return { success: false, error: 'Missing NotifyX API key' }
    }

    const response = await fetch(`https://www.notifyx.cn/api/v1/send/${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: '订阅到期提醒',
        content: message,
        description: 'SubTracker 订阅管理系统'
      })
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error: this.sanitizeErrorMessage(error) }
    }

    return { success: true }
  }

  /**
   * 清理错误消息，移除可能包含的敏感信息
   */
  private sanitizeErrorMessage(error: string): string {
    if (!error || typeof error !== 'string') {
      return 'Unknown error'
    }
    // 限制错误消息长度
    let sanitized = error.slice(0, 500)
    // 移除可能的 token/key 模式
    sanitized = sanitized.replace(/(?:token|key|secret|password|apikey)["\s:=]+[^\s,"]+/gi, '$1: [REDACTED]')
    return sanitized
  }

  async logNotification(
    subscriptionId: string,
    channelId: string,
    channelType: string,
    success: boolean,
    error?: string
  ) {
    const id = crypto.randomUUID()
    // 清理错误消息，不存储可能包含敏感信息的原始错误
    const sanitizedError = error ? this.sanitizeErrorMessage(error) : null
    // 错误消息加密存储（可能包含通道返回的敏感信息）
    let encryptedError: string | null = null
    if (sanitizedError) {
      try {
        const key = this.validateEncryptionKey()
        encryptedError = await encrypt(sanitizedError, key)
      } catch {
        encryptedError = null
      }
    }

    await this.db.insert(schema.notificationLogs).values({
      id,
      subscriptionId,
      channelId,
      channelType,
      success: success ? 1 : 0,
      errorMessage: encryptedError
    }).run()
  }

  async getLogs(userId: string, limit: number = 50) {
    const rows = (await this.db.select({
      log: schema.notificationLogs,
      subscription: schema.subscriptions.name
    })
      .from(schema.notificationLogs)
      .innerJoin(schema.subscriptions, eq(schema.notificationLogs.subscriptionId, schema.subscriptions.id))
      .where(eq(schema.subscriptions.userId, userId))
      .orderBy(desc(schema.notificationLogs.sentAt))
      .limit(limit)
      .all()) as any[]

    // 解密订阅名称（已加密存储）和错误消息
    const key = this.validateEncryptionKey()
    for (const row of rows) {
      if (row.subscription) {
        row.subscription = (await decryptField(row.subscription as string, key)) ?? row.subscription
      }
      if (row.log && row.log.errorMessage) {
        row.log.errorMessage = await decryptField(row.log.errorMessage as string, key)
      }
    }

    return rows
  }

  async hasSentNotification(subscriptionId: string, channelId: string, daysBeforeExpiry: number): Promise<boolean> {
    const today = new Date()
    const targetDate = new Date(today.getTime() + daysBeforeExpiry * 24 * 60 * 60 * 1000)
    const targetDateStr = targetDate.toISOString().split('T')[0]

    const logs = (await this.db.select().from(schema.notificationLogs)
      .where(and(
        eq(schema.notificationLogs.subscriptionId, subscriptionId),
        eq(schema.notificationLogs.channelId, channelId)
      ))
      .all()) as any[]

    const found = logs.find((log: any) => {
      const logDate = new Date(log.sentAt!)
      return logDate.toISOString().split('T')[0] === targetDateStr
    })

    return !!found
  }
}

export function createNotificationService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey?: string
): NotificationService {
  return new NotificationService(db, encryptionKey)
}
