import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, and } from 'drizzle-orm'
import type { CreateGroupRequest, UpdateGroupRequest } from '../types'
import { encrypt, decryptField, MIN_ENCRYPTION_KEY_LENGTH } from './crypto'

type GroupRow = {
  id: string
  name: string
  color: string | null
  icon: string | null
  sortOrder: number | null
  userId: string
  createdAt: Date | null
}

export class GroupService {
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
   * 解密单条分组记录的敏感字段
   */
  private async decryptRecord(record: GroupRow): Promise<void> {
    if (!record) return
    const key = this.validateEncryptionKey()
    record.name = (await decryptField(record.name, key)) ?? ''
    record.color = await decryptField(record.color, key)
    record.icon = await decryptField(record.icon, key)
  }

  async getAll(userId: string): Promise<GroupRow[]> {
    const rows = (await this.db.select().from(schema.groups)
      .where(eq(schema.groups.userId, userId))
      .orderBy(schema.groups.sortOrder)
      .all()) as unknown as GroupRow[]
    for (const row of rows) {
      await this.decryptRecord(row)
    }
    return rows
  }

  async getById(id: string, userId: string): Promise<GroupRow | undefined> {
    const rows = (await this.db.select().from(schema.groups)
      .where(and(eq(schema.groups.id, id), eq(schema.groups.userId, userId)))
      .all()) as unknown as GroupRow[]
    const row = rows[0]
    if (row) {
      await this.decryptRecord(row)
    }
    return row
  }

  async create(userId: string, data: CreateGroupRequest): Promise<GroupRow | undefined> {
    const id = crypto.randomUUID()
    const key = this.validateEncryptionKey()

    const encryptedName = await encrypt(data.name, key)
    const encryptedColor = data.color ? await encrypt(data.color, key) : '#6366F1'
    const encryptedIcon = data.icon ? await encrypt(data.icon, key) : null

    await this.db.insert(schema.groups).values({
      id,
      name: encryptedName,
      color: encryptedColor,
      icon: encryptedIcon,
      sortOrder: data.sortOrder || 0,
      userId
    }).run()

    return this.getById(id, userId)
  }

  async update(id: string, userId: string, data: UpdateGroupRequest): Promise<GroupRow | undefined> {
    const key = this.validateEncryptionKey()
    const updates: Record<string, unknown> = {}

    if (data.name !== undefined) updates.name = await encrypt(data.name, key)
    if (data.color !== undefined && data.color !== null && data.color !== '') {
      updates.color = await encrypt(data.color, key)
    }
    if (data.icon !== undefined && data.icon !== null && data.icon !== '') {
      updates.icon = await encrypt(data.icon, key)
    }
    if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder

    await this.db.update(schema.groups)
      .set(updates)
      .where(and(eq(schema.groups.id, id), eq(schema.groups.userId, userId)))
      .run()

    return this.getById(id, userId)
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.db.delete(schema.groups)
      .where(and(eq(schema.groups.id, id), eq(schema.groups.userId, userId)))
      .run()
  }
}

export function createGroupService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey?: string
): GroupService {
  return new GroupService(db, encryptionKey)
}
