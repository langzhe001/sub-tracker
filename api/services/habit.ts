import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, and } from 'drizzle-orm'
import type {
  CreateHabitRequest,
  UpdateHabitRequest,
  CreateHabitRecordRequest,
  UpdateHabitRecordRequest,
  HabitStats
} from '../types'
import { encrypt, decryptField, MIN_ENCRYPTION_KEY_LENGTH } from './crypto'

/* =========================================================================
 * HabitService：习惯打卡服务
 * 敏感字段（name/description）使用 AES-GCM 加密存储
 * 打卡记录按 habitId + date 聚合，count 字段累计当日打卡次数
 * ========================================================================= */

type HabitRow = {
  id: string
  name: string
  description: string | null
  color: string | null
  icon: string | null
  frequency: string | null
  weeklyDays: string | null
  customDays: number | null
  goal: number | null
  remindTime: string | null
  archived: number | null
  sortOrder: number | null
  userId: string
  createdAt: Date | null
  updatedAt: Date | null
}

type HabitRecordRow = {
  id: string
  habitId: string
  date: string
  count: number | null
  note: string | null
  userId: string
  createdAt: Date | null
}

export class HabitService {
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

  private async decryptHabit(record: HabitRow): Promise<void> {
    if (!record) return
    const key = this.validateEncryptionKey()
    record.name = (await decryptField(record.name, key)) ?? ''
    record.description = await decryptField(record.description, key)
    record.icon = await decryptField(record.icon, key)
    record.remindTime = await decryptField(record.remindTime, key)
  }

  // ============ 习惯 CRUD ============

  async getAll(userId: string, includeArchived = false): Promise<HabitRow[]> {
    const rows = (await this.db.select().from(schema.habits)
      .where(eq(schema.habits.userId, userId))
      .all()) as unknown as HabitRow[]
    const filtered = includeArchived ? rows : rows.filter((r) => r.archived !== 1)
    for (const row of filtered) {
      await this.decryptHabit(row)
    }
    return filtered.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  }

  async getById(id: string, userId: string): Promise<HabitRow | undefined> {
    const results = (await this.db.select().from(schema.habits)
      .where(and(eq(schema.habits.id, id), eq(schema.habits.userId, userId)))
      .all()) as unknown as HabitRow[]
    const row = results[0]
    if (row) {
      await this.decryptHabit(row)
    }
    return row
  }

  async create(userId: string, data: CreateHabitRequest): Promise<HabitRow | undefined> {
    const id = crypto.randomUUID()
    const key = this.validateEncryptionKey()
    const encryptedName = await encrypt(data.name.slice(0, 200), key)
    const encryptedDescription = data.description
      ? await encrypt(data.description.slice(0, 500), key)
      : null
    const encryptedIcon = data.icon ? await encrypt(data.icon.slice(0, 16), key) : null
    const encryptedRemindTime = data.remindTime ? await encrypt(data.remindTime, key) : null

    await this.db.insert(schema.habits).values({
      id,
      name: encryptedName,
      description: encryptedDescription,
      color: data.color || '#6366F1',
      icon: encryptedIcon,
      frequency: data.frequency || 'daily',
      weeklyDays: data.weeklyDays || null,
      customDays: Number(data.customDays) || 1,
      goal: Number(data.goal) || 1,
      remindTime: encryptedRemindTime,
      archived: 0,
      sortOrder: data.sortOrder || 0,
      userId
    }).run()

    return this.getById(id, userId)
  }

  async update(id: string, userId: string, data: UpdateHabitRequest): Promise<HabitRow | undefined> {
    const key = this.validateEncryptionKey()
    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (data.name !== undefined) {
      updates.name = await encrypt(data.name.slice(0, 200), key)
    }
    if (data.description !== undefined) {
      updates.description = data.description
        ? await encrypt(data.description.slice(0, 500), key)
        : null
    }
    if (data.color !== undefined) {
      updates.color = data.color
    }
    if (data.icon !== undefined) {
      updates.icon = data.icon ? await encrypt(data.icon.slice(0, 16), key) : null
    }
    if (data.frequency !== undefined) {
      updates.frequency = data.frequency
    }
    if (data.weeklyDays !== undefined) {
      updates.weeklyDays = data.weeklyDays || null
    }
    if (data.customDays !== undefined) {
      updates.customDays = Number(data.customDays) || 1
    }
    if (data.goal !== undefined) {
      updates.goal = Number(data.goal) || 1
    }
    if (data.remindTime !== undefined) {
      updates.remindTime = data.remindTime ? await encrypt(data.remindTime, key) : null
    }
    if (data.archived !== undefined) {
      updates.archived = data.archived ? 1 : 0
    }
    if (data.sortOrder !== undefined) {
      updates.sortOrder = data.sortOrder
    }

    await this.db.update(schema.habits)
      .set(updates)
      .where(and(eq(schema.habits.id, id), eq(schema.habits.userId, userId)))
      .run()

    return this.getById(id, userId)
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.db.delete(schema.habits)
      .where(and(eq(schema.habits.id, id), eq(schema.habits.userId, userId)))
      .run()
  }

  // ============ 打卡记录 ============

  async getRecords(habitId: string, userId: string, startDate?: string, endDate?: string): Promise<HabitRecordRow[]> {
    let query = this.db.select().from(schema.habitRecords)
      .where(and(eq(schema.habitRecords.habitId, habitId), eq(schema.habitRecords.userId, userId)))

    const conditions = []
    if (startDate) conditions.push(eq(schema.habitRecords.date, startDate)) // 简化：用应用层范围过滤
    if (conditions.length === 0) {
      const rows = await query.all() as unknown as HabitRecordRow[]
      return startDate && endDate
        ? rows.filter((r) => r.date >= startDate && r.date <= endDate)
        : rows
    }
    const rows = await query.all() as unknown as HabitRecordRow[]
    return startDate && endDate
      ? rows.filter((r) => r.date >= startDate && r.date <= endDate)
      : rows
  }

  /**
   * 获取用户所有习惯在某日期范围内的打卡记录
   * 返回格式：{ [habitId]: HabitRecordRow[] }
   */
  async getAllRecordsByDateRange(userId: string, startDate: string, endDate: string): Promise<Map<string, HabitRecordRow[]>> {
    const rows = (await this.db.select().from(schema.habitRecords)
      .where(eq(schema.habitRecords.userId, userId))
      .all()) as unknown as HabitRecordRow[]
    const map = new Map<string, HabitRecordRow[]>()
    for (const r of rows) {
      if (r.date >= startDate && r.date <= endDate) {
        if (!map.has(r.habitId)) map.set(r.habitId, [])
        map.get(r.habitId)!.push(r)
      }
    }
    return map
  }

  async createRecord(userId: string, data: CreateHabitRecordRequest): Promise<HabitRecordRow | undefined> {
    const id = crypto.randomUUID()
    await this.db.insert(schema.habitRecords).values({
      id,
      habitId: data.habitId,
      date: data.date,
      count: Number(data.count) || 1,
      note: data.note || null,
      userId
    }).run()

    const results = (await this.db.select().from(schema.habitRecords)
      .where(eq(schema.habitRecords.id, id))
      .all()) as unknown as HabitRecordRow[]
    return results[0]
  }

  async updateRecord(id: string, userId: string, data: UpdateHabitRecordRequest): Promise<HabitRecordRow | undefined> {
    const updates: Record<string, unknown> = {}
    if (data.count !== undefined) updates.count = Number(data.count) || 1
    if (data.note !== undefined) updates.note = data.note || null
    if (data.date !== undefined) updates.date = data.date

    await this.db.update(schema.habitRecords)
      .set(updates)
      .where(and(eq(schema.habitRecords.id, id), eq(schema.habitRecords.userId, userId)))
      .run()

    const results = (await this.db.select().from(schema.habitRecords)
      .where(eq(schema.habitRecords.id, id))
      .all()) as unknown as HabitRecordRow[]
    return results[0]
  }

  async deleteRecord(id: string, userId: string): Promise<void> {
    await this.db.delete(schema.habitRecords)
      .where(and(eq(schema.habitRecords.id, id), eq(schema.habitRecords.userId, userId)))
      .run()
  }

  /**
   * 删除某个习惯某天的全部打卡（用于撤销当日打卡）
   */
  async deleteRecordsByDate(habitId: string, date: string, userId: string): Promise<number> {
    const rows = (await this.db.select().from(schema.habitRecords)
      .where(and(
        eq(schema.habitRecords.habitId, habitId),
        eq(schema.habitRecords.userId, userId)
      ))
      .all()) as unknown as HabitRecordRow[]
    const target = rows.filter((r) => r.date === date)
    for (const r of target) {
      await this.db.delete(schema.habitRecords)
        .where(eq(schema.habitRecords.id, r.id))
        .run()
    }
    return target.length
  }

  // ============ 统计 ============

  async getStats(userId: string): Promise<HabitStats> {
    const allHabits = (await this.db.select().from(schema.habits)
      .where(eq(schema.habits.userId, userId))
      .all()) as unknown as HabitRow[]
    const activeHabits = allHabits.filter((h) => h.archived !== 1)

    const today = new Date().toISOString().split('T')[0]
    const allRecords = (await this.db.select().from(schema.habitRecords)
      .where(eq(schema.habitRecords.userId, userId))
      .all()) as unknown as HabitRecordRow[]
    const todayRecords = allRecords.filter((r) => r.date === today)

    return {
      totalHabits: allHabits.length,
      activeHabits: activeHabits.length,
      todayCompleted: todayRecords.length,
      totalCheckIns: allRecords.length
    }
  }
}

export function createHabitService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey?: string
): HabitService {
  return new HabitService(db, encryptionKey)
}
