import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq } from 'drizzle-orm'
import { encrypt, decryptField, encryptJSON, decryptJSON, isEncrypted, MIN_ENCRYPTION_KEY_LENGTH } from './crypto'

/* =========================================================================
 * BackupService：聚合全量用户数据的备份与恢复
 *
 * 数据范围：
 *   1. 订阅模块：subscriptions / groups / notificationChannels
 *   2. 任务模块：taskFolders / taskLists / tasks / subtasks / tags / taskTags
 *
 * 所有敏感字段已使用 AES-GCM 加密存储，导出时解密为明文，导入时重新加密。
 * 导入时维护 ID 映射表，确保外键关系（groupId / folderId / listId / taskId / tagId）
 * 在重建后依然正确关联。
 * ========================================================================= */

type AnyRow = Record<string, any>

export class BackupService {
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

  /* =======================================================================
   * 导出全量数据
   * ===================================================================== */

  async exportAllData(userId: string) {
    const key = this.validateEncryptionKey()

    // ---- 订阅 ----
    const subRows = (await this.db.select().from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, userId))
      .all()) as unknown as AnyRow[]
    const subscriptions = []
    for (const s of subRows) {
      subscriptions.push({
        id: s.id,
        name: (await decryptField(s.name, key)) ?? '',
        description: (await decryptField(s.description, key)) ?? '',
        icon: (await decryptField(s.icon, key)) ?? '',
        amount: s.amount !== null && s.amount !== undefined && s.amount !== ''
          ? Number(await decryptField(s.amount, key)) : null,
        currency: (await decryptField(s.currency, key)) ?? 'CNY',
        renewalPeriod: (await decryptField(s.renewalPeriod, key)) ?? 'monthly',
        expireDate: (await decryptField(s.expireDate, key)) ?? '',
        reminderDays: Number(await decryptField(s.reminderDays, key)) || 7,
        extendMode: (await decryptField(s.extendMode, key)) ?? 'expire',
        customRenewalDays: Number(await decryptField(s.customRenewalDays, key)) || 30,
        groupId: s.groupId ?? null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      })
    }

    // ---- 分组 ----
    const groupRows = (await this.db.select().from(schema.groups)
      .where(eq(schema.groups.userId, userId))
      .all()) as unknown as AnyRow[]
    const groups = []
    for (const g of groupRows) {
      groups.push({
        id: g.id,
        name: (await decryptField(g.name, key)) ?? g.name ?? '',
        color: g.color ?? '#6366F1',
        icon: g.icon ?? '',
        sortOrder: g.sortOrder ?? 0,
        createdAt: g.createdAt
      })
    }

    // ---- 通知渠道（name + config 加密） ----
    const channelRows = (await this.db.select().from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.userId, userId))
      .all()) as unknown as AnyRow[]
    const channels = []
    for (const ch of channelRows) {
      const name = (await decryptField(ch.name, key)) ?? ch.name ?? ''
      let config: Record<string, string> = {}
      if (ch.config) {
        try {
          if (isEncrypted(ch.config)) {
            config = await decryptJSON<Record<string, string>>(ch.config, key)
          } else {
            config = JSON.parse(ch.config) as Record<string, string>
          }
        } catch {
          config = {}
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

    // ---- 任务文件夹 ----
    const folderRows = (await this.db.select().from(schema.taskFolders)
      .where(eq(schema.taskFolders.userId, userId))
      .all()) as unknown as AnyRow[]
    const taskFolders = []
    for (const f of folderRows) {
      taskFolders.push({
        id: f.id,
        name: (await decryptField(f.name, key)) ?? f.name ?? '',
        sortOrder: f.sortOrder ?? 0,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt
      })
    }

    // ---- 任务清单 ----
    const listRows = (await this.db.select().from(schema.taskLists)
      .where(eq(schema.taskLists.userId, userId))
      .all()) as unknown as AnyRow[]
    const taskLists = []
    for (const l of listRows) {
      taskLists.push({
        id: l.id,
        name: (await decryptField(l.name, key)) ?? l.name ?? '',
        color: (await decryptField(l.color, key)) ?? '#6366F1',
        icon: (await decryptField(l.icon, key)) ?? '',
        folderId: l.folderId ?? null,
        sortOrder: l.sortOrder ?? 0,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt
      })
    }

    // ---- 任务 ----
    const taskRows = (await this.db.select().from(schema.tasks)
      .where(eq(schema.tasks.userId, userId))
      .all()) as unknown as AnyRow[]
    const tasks = []
    for (const t of taskRows) {
      tasks.push({
        id: t.id,
        title: (await decryptField(t.title, key)) ?? t.title ?? '',
        description: (await decryptField(t.description, key)) ?? '',
        listId: t.listId ?? null,
        priority: t.priority ?? 0,
        status: t.status ?? 'todo',
        dueDate: (await decryptField(t.dueDate, key)) ?? null,
        remindAt: (await decryptField(t.remindAt, key)) ?? null,
        sortOrder: t.sortOrder ?? 0,
        pinned: t.pinned === 1,
        completedAt: t.completedAt,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt
      })
    }

    // ---- 子任务 ----
    const subtaskRows = (await this.db.select().from(schema.subtasks)
      .where(eq(schema.subtasks.userId, userId))
      .all()) as unknown as AnyRow[]
    const subtasks = []
    for (const s of subtaskRows) {
      subtasks.push({
        id: s.id,
        taskId: s.taskId,
        title: (await decryptField(s.title, key)) ?? s.title ?? '',
        status: s.status ?? 'todo',
        sortOrder: s.sortOrder ?? 0,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      })
    }

    // ---- 标签 ----
    const tagRows = (await this.db.select().from(schema.tags)
      .where(eq(schema.tags.userId, userId))
      .all()) as unknown as AnyRow[]
    const tags = []
    for (const t of tagRows) {
      tags.push({
        id: t.id,
        name: (await decryptField(t.name, key)) ?? t.name ?? '',
        color: (await decryptField(t.color, key)) ?? '#6366F1',
        createdAt: t.createdAt
      })
    }

    // ---- 任务-标签关联 ----
    const taskTagRows = (await this.db.select().from(schema.taskTags)
      .where(eq(schema.taskTags.userId, userId))
      .all()) as unknown as AnyRow[]
    const taskTags = taskTagRows.map((tt) => ({
      id: tt.id,
      taskId: tt.taskId,
      tagId: tt.tagId,
      createdAt: tt.createdAt
    }))

    return {
      exportedAt: new Date().toISOString(),
      version: 2,
      app: 'sub-tracker',
      subscriptions,
      groups,
      channels,
      taskFolders,
      taskLists,
      tasks,
      subtasks,
      tags,
      taskTags
    }
  }

  /* =======================================================================
   * 恢复全量数据
   * mode:
   *   - 'replace'：先清空用户所有数据（订阅+任务模块），再导入
   *   - 'merge'：保留现有数据，追加导入（会生成新 ID，可能重复）
   * 维护 ID 映射：groupId / folderId / listId / taskId / tagId
   * ===================================================================== */

  async importAllData(
    userId: string,
    backup: Record<string, any>,
    mode: 'replace' | 'merge' = 'replace'
  ) {
    const key = this.validateEncryptionKey()

    const subs = Array.isArray(backup.subscriptions) ? backup.subscriptions : []
    const groups = Array.isArray(backup.groups) ? backup.groups : []
    const channels = Array.isArray(backup.channels) ? backup.channels : []
    const folders = Array.isArray(backup.taskFolders) ? backup.taskFolders : []
    const lists = Array.isArray(backup.taskLists) ? backup.taskLists : []
    const tasks = Array.isArray(backup.tasks) ? backup.tasks : []
    const subtasks = Array.isArray(backup.subtasks) ? backup.subtasks : []
    const tags = Array.isArray(backup.tags) ? backup.tags : []
    const taskTags = Array.isArray(backup.taskTags) ? backup.taskTags : []

    const MAX = 5000
    for (const arr of [subs, groups, channels, folders, lists, tasks, subtasks, tags, taskTags]) {
      if (arr.length > MAX) throw new Error(`Import data too large (max ${MAX} per category)`)
    }

    // replace 模式：清空用户所有数据（注意外键顺序：先子表后父表）
    if (mode === 'replace') {
      await this.db.delete(schema.taskTags).where(eq(schema.taskTags.userId, userId)).run()
      await this.db.delete(schema.subtasks).where(eq(schema.subtasks.userId, userId)).run()
      await this.db.delete(schema.tasks).where(eq(schema.tasks.userId, userId)).run()
      await this.db.delete(schema.tags).where(eq(schema.tags.userId, userId)).run()
      await this.db.delete(schema.taskLists).where(eq(schema.taskLists.userId, userId)).run()
      await this.db.delete(schema.taskFolders).where(eq(schema.taskFolders.userId, userId)).run()
      await this.db.delete(schema.subscriptions).where(eq(schema.subscriptions.userId, userId)).run()
      await this.db.delete(schema.notificationChannels).where(eq(schema.notificationChannels.userId, userId)).run()
      await this.db.delete(schema.groups).where(eq(schema.groups.userId, userId)).run()
    }

    // ID 映射表
    const groupIdMap = new Map<string, string>()
    const folderIdMap = new Map<string, string>()
    const listIdMap = new Map<string, string>()
    const taskIdMap = new Map<string, string>()
    const tagIdMap = new Map<string, string>()

    const cnt = { subscriptions: 0, groups: 0, channels: 0, taskFolders: 0, taskLists: 0, tasks: 0, subtasks: 0, tags: 0, taskTags: 0 }

    // 1. 导入分组
    for (const g of groups) {
      if (!g || typeof g.name !== 'string' || !g.name) continue
      const newId = crypto.randomUUID()
      if (typeof g.id === 'string') groupIdMap.set(g.id, newId)
      await this.db.insert(schema.groups).values({
        id: newId,
        name: await encrypt(String(g.name).slice(0, 200), key),
        color: typeof g.color === 'string' ? g.color : '#6366F1',
        icon: typeof g.icon === 'string' && g.icon ? g.icon.slice(0, 16) : null,
        sortOrder: Number(g.sortOrder) || 0,
        userId
      }).run()
      cnt.groups++
    }

    // 2. 导入通知渠道
    for (const ch of channels) {
      if (!ch || typeof ch.type !== 'string' || !ch.type) continue
      if (typeof ch.name !== 'string' || !ch.name) continue
      const id = crypto.randomUUID()
      let configStr = '{}'
      if (ch.config && typeof ch.config === 'object') {
        const cfg: Record<string, string> = {}
        const cfgObj = ch.config as Record<string, unknown>
        for (const k of Object.keys(cfgObj).slice(0, 20)) {
          const v = cfgObj[k]
          if (typeof v === 'string') cfg[k] = v.slice(0, 8192)
        }
        configStr = await encryptJSON(cfg, key)
      }
      await this.db.insert(schema.notificationChannels).values({
        id,
        type: ch.type,
        name: await encrypt(String(ch.name).slice(0, 200), key),
        config: configStr,
        enabled: ch.enabled === false || ch.enabled === 0 ? 0 : 1,
        userId
      }).run()
      cnt.channels++
    }

    // 3. 导入订阅（使用 groupId 映射）
    for (const s of subs) {
      if (!s || typeof s.name !== 'string' || !s.name) continue
      const id = crypto.randomUUID()
      let groupId: string | null = null
      if (typeof s.groupId === 'string' && s.groupId) {
        groupId = groupIdMap.get(s.groupId) ?? null
      }
      await this.db.insert(schema.subscriptions).values({
        id,
        name: await encrypt(String(s.name).slice(0, 200), key),
        description: typeof s.description === 'string' && s.description
          ? await encrypt(String(s.description).slice(0, 500), key) : null,
        icon: typeof s.icon === 'string' && s.icon
          ? await encrypt(String(s.icon).slice(0, 16), key) : null,
        amount: s.amount !== undefined && s.amount !== null && s.amount !== ''
          ? await encrypt(String(s.amount), key) : null,
        currency: await encrypt(typeof s.currency === 'string' && s.currency ? s.currency : 'CNY', key),
        renewalPeriod: await encrypt(typeof s.renewalPeriod === 'string' && s.renewalPeriod ? s.renewalPeriod : 'monthly', key),
        expireDate: await encrypt(typeof s.expireDate === 'string' && s.expireDate ? s.expireDate : new Date().toISOString().split('T')[0], key),
        reminderDays: await encrypt(String(Number(s.reminderDays) || 7), key),
        extendMode: await encrypt(typeof s.extendMode === 'string' && s.extendMode ? s.extendMode : 'expire', key),
        customRenewalDays: await encrypt(String(Number(s.customRenewalDays) || 30), key),
        groupId,
        userId
      }).run()
      cnt.subscriptions++
    }

    // 4. 导入任务文件夹
    for (const f of folders) {
      if (!f || typeof f.name !== 'string' || !f.name) continue
      const newId = crypto.randomUUID()
      if (typeof f.id === 'string') folderIdMap.set(f.id, newId)
      await this.db.insert(schema.taskFolders).values({
        id: newId,
        name: await encrypt(String(f.name).slice(0, 200), key),
        sortOrder: Number(f.sortOrder) || 0,
        userId
      }).run()
      cnt.taskFolders++
    }

    // 5. 导入任务清单（使用 folderId 映射）
    for (const l of lists) {
      if (!l || typeof l.name !== 'string' || !l.name) continue
      const newId = crypto.randomUUID()
      if (typeof l.id === 'string') listIdMap.set(l.id, newId)
      let folderId: string | null = null
      if (typeof l.folderId === 'string' && l.folderId) {
        folderId = folderIdMap.get(l.folderId) ?? null
      }
      const color = typeof l.color === 'string' && l.color ? l.color : '#6366F1'
      await this.db.insert(schema.taskLists).values({
        id: newId,
        name: await encrypt(String(l.name).slice(0, 200), key),
        color: await encrypt(color, key),
        icon: typeof l.icon === 'string' && l.icon ? await encrypt(String(l.icon).slice(0, 16), key) : null,
        folderId,
        sortOrder: Number(l.sortOrder) || 0,
        userId
      }).run()
      cnt.taskLists++
    }

    // 6. 导入标签
    for (const t of tags) {
      if (!t || typeof t.name !== 'string' || !t.name) continue
      const newId = crypto.randomUUID()
      if (typeof t.id === 'string') tagIdMap.set(t.id, newId)
      const color = typeof t.color === 'string' && t.color ? t.color : '#6366F1'
      await this.db.insert(schema.tags).values({
        id: newId,
        name: await encrypt(String(t.name).slice(0, 100), key),
        color: await encrypt(color, key),
        userId
      }).run()
      cnt.tags++
    }

    // 7. 导入任务（使用 listId 映射）
    for (const t of tasks) {
      if (!t || typeof t.title !== 'string' || !t.title) continue
      const newId = crypto.randomUUID()
      if (typeof t.id === 'string') taskIdMap.set(t.id, newId)
      let listId: string | null = null
      if (typeof t.listId === 'string' && t.listId) {
        listId = listIdMap.get(t.listId) ?? null
      }
      const status = t.status === 'done' ? 'done' : 'todo'
      const completedAt = status === 'done' ? new Date() : null
      await this.db.insert(schema.tasks).values({
        id: newId,
        title: await encrypt(String(t.title).slice(0, 500), key),
        description: typeof t.description === 'string' && t.description
          ? await encrypt(String(t.description).slice(0, 2000), key) : null,
        listId,
        priority: [0, 1, 2, 3].includes(Number(t.priority)) ? Number(t.priority) : 0,
        status,
        dueDate: typeof t.dueDate === 'string' && t.dueDate ? await encrypt(t.dueDate, key) : null,
        remindAt: typeof t.remindAt === 'string' && t.remindAt ? await encrypt(String(t.remindAt).slice(0, 32), key) : null,
        sortOrder: Number(t.sortOrder) || 0,
        pinned: t.pinned ? 1 : 0,
        completedAt,
        userId
      }).run()
      cnt.tasks++
    }

    // 8. 导入子任务（使用 taskId 映射）
    for (const s of subtasks) {
      if (!s || typeof s.title !== 'string' || !s.title) continue
      if (typeof s.taskId !== 'string' || !s.taskId) continue
      const newTaskId = taskIdMap.get(s.taskId)
      if (!newTaskId) continue // 找不到对应任务则跳过
      const id = crypto.randomUUID()
      const status = s.status === 'done' ? 'done' : 'todo'
      await this.db.insert(schema.subtasks).values({
        id,
        taskId: newTaskId,
        title: await encrypt(String(s.title).slice(0, 500), key),
        status,
        sortOrder: Number(s.sortOrder) || 0,
        userId
      }).run()
      cnt.subtasks++
    }

    // 9. 导入任务-标签关联（使用 taskId + tagId 映射）
    for (const tt of taskTags) {
      if (!tt || typeof tt.taskId !== 'string' || typeof tt.tagId !== 'string') continue
      const newTaskId = taskIdMap.get(tt.taskId)
      const newTagId = tagIdMap.get(tt.tagId)
      if (!newTaskId || !newTagId) continue
      const id = crypto.randomUUID()
      await this.db.insert(schema.taskTags).values({
        id,
        taskId: newTaskId,
        tagId: newTagId,
        userId
      }).run()
      cnt.taskTags++
    }

    return cnt
  }
}

export function createBackupService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey?: string
): BackupService {
  return new BackupService(db, encryptionKey)
}
