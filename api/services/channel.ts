import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, and } from 'drizzle-orm'
import type { CreateChannelRequest, UpdateChannelRequest, ChannelType } from '../types'
import {
  encrypt,
  encryptJSON,
  decryptJSON,
  decryptField,
  isEncrypted,
  MIN_ENCRYPTION_KEY_LENGTH
} from './crypto'

export class ChannelService {
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
   * 加密配置并返回加密后的字符串
   */
  private async encryptConfig(config: Record<string, string>): Promise<string> {
    const key = this.validateEncryptionKey()
    return encryptJSON(config, key)
  }

  /**
   * 解密配置并返回对象
   */
  private async decryptConfig(configStr: string): Promise<Record<string, string>> {
    // 兼容未加密的旧数据
    if (!isEncrypted(configStr)) {
      try {
        return JSON.parse(configStr) as Record<string, string>
      } catch {
        return {}
      }
    }
    const key = this.validateEncryptionKey()
    return decryptJSON<Record<string, string>>(configStr, key)
  }

  /**
   * 解密通道的 name 字段（兼容未加密旧数据）
   */
  private async decryptChannelName(channel: { name: string }): Promise<void> {
    if (!channel || !channel.name) return
    const key = this.validateEncryptionKey()
    channel.name = (await decryptField(channel.name, key)) ?? channel.name
  }

  /**
   * 解密单个通道的 name 和 config
   */
  private async decryptChannelFields(channel: { name: string; config: string }): Promise<void> {
    if (!channel) return
    await this.decryptChannelName(channel)
    if (channel.config) {
      try {
        channel.config = JSON.stringify(await this.decryptConfig(channel.config as string))
      } catch {
        channel.config = '{}'
      }
    }
  }

  async getAll(userId: string) {
    const channels = await this.db.select().from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.userId, userId))
      .all()

    for (const channel of channels) {
      await this.decryptChannelFields(channel as unknown as { name: string; config: string })
    }

    return channels
  }

  async getById(id: string, userId: string) {
    const results = await this.db.select().from(schema.notificationChannels)
      .where(and(eq(schema.notificationChannels.id, id), eq(schema.notificationChannels.userId, userId)))
      .all()
    const channel = results[0]

    if (channel) {
      await this.decryptChannelFields(channel as unknown as { name: string; config: string })
    }

    return channel
  }

  async getEnabled(userId: string) {
    const channels = await this.db.select().from(schema.notificationChannels)
      .where(and(
        eq(schema.notificationChannels.userId, userId),
        eq(schema.notificationChannels.enabled, 1)
      ))
      .all()

    for (const channel of channels) {
      await this.decryptChannelFields(channel as unknown as { name: string; config: string })
    }

    return channels
  }

  async create(userId: string, data: CreateChannelRequest) {
    const id = crypto.randomUUID()
    const key = this.validateEncryptionKey()
    const encryptedConfig = await this.encryptConfig(data.config)
    // name 字段加密存储
    const encryptedName = await encrypt(data.name, key)

    await this.db.insert(schema.notificationChannels).values({
      id,
      type: data.type,
      name: encryptedName,
      config: encryptedConfig,
      enabled: data.enabled !== false ? 1 : 0,
      userId
    }).run()

    return this.getById(id, userId)
  }

  async update(id: string, userId: string, data: UpdateChannelRequest) {
    const key = this.validateEncryptionKey()
    const updates: Record<string, unknown> = {}

    if (data.name !== undefined) updates.name = await encrypt(data.name, key)
    if (data.config !== undefined) {
      updates.config = await this.encryptConfig(data.config as Record<string, string>)
    }
    if (data.enabled !== undefined) updates.enabled = data.enabled ? 1 : 0

    await this.db.update(schema.notificationChannels)
      .set(updates)
      .where(and(eq(schema.notificationChannels.id, id), eq(schema.notificationChannels.userId, userId)))
      .run()

    return this.getById(id, userId)
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.db.delete(schema.notificationChannels)
      .where(and(eq(schema.notificationChannels.id, id), eq(schema.notificationChannels.userId, userId)))
      .run()
  }

  async testChannel(id: string, userId: string): Promise<{ success: boolean; error?: string }> {
    const channel = await this.getById(id, userId)
    if (!channel) {
      return { success: false, error: 'Channel not found' }
    }

    const config = JSON.parse(channel.config as string) as Record<string, string>

    try {
      switch (channel.type as ChannelType) {
        case 'email':
          return { success: true }
        case 'telegram':
          if (!config.botToken || !config.chatId) {
            return { success: false, error: 'Missing Telegram bot token or chat ID' }
          }
          return { success: true }
        case 'feishu':
          if (!config.webhookUrl) {
            return { success: false, error: 'Missing Feishu webhook URL' }
          }
          return { success: true }
        case 'wechat':
          if (!config.webhookUrl) {
            return { success: false, error: 'Missing WeChat webhook URL' }
          }
          return { success: true }
        case 'notifyx':
          if (!config.apiKey) {
            return { success: false, error: 'Missing NotifyX API key' }
          }
          return { success: true }
        default:
          return { success: false, error: 'Unknown channel type' }
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }
}

export function createChannelService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey?: string
): ChannelService {
  return new ChannelService(db, encryptionKey)
}
