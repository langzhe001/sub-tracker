import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, and } from 'drizzle-orm'
import type {
  CreateTaskFolderRequest,
  UpdateTaskFolderRequest,
  CreateTaskListRequest,
  UpdateTaskListRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  CreateSubtaskRequest,
  UpdateSubtaskRequest,
  CreateTagRequest,
  UpdateTagRequest,
  TaskStats,
  TaskStatus
} from '../types'
import {
  encrypt,
  decryptField,
  MIN_ENCRYPTION_KEY_LENGTH
} from './crypto'

// ============ 类型定义 ============

type TaskFolderRow = {
  id: string
  name: string
  sortOrder: number | null
  userId: string
  createdAt: Date | null
  updatedAt: Date | null
}

type TaskListRow = {
  id: string
  name: string
  color: string | null
  icon: string | null
  folderId: string | null
  sortOrder: number | null
  userId: string
  createdAt: Date | null
  updatedAt: Date | null
}

type TaskRow = {
  id: string
  title: string
  description: string | null
  listId: string | null
  priority: number | null
  status: string | null
  dueDate: string | null
  remindAt: string | null
  sortOrder: number | null
  pinned: number | null
  completedAt: Date | null
  userId: string
  createdAt: Date | null
  updatedAt: Date | null
}

type SubtaskRow = {
  id: string
  taskId: string
  title: string
  status: string | null
  sortOrder: number | null
  userId: string
  createdAt: Date | null
  updatedAt: Date | null
}

type TagRow = {
  id: string
  name: string
  color: string | null
  userId: string
  createdAt: Date | null
}

type TaskTagRow = {
  id: string
  taskId: string
  tagId: string
  userId: string
  createdAt: Date | null
}

// ============ 任务文件夹服务 ============

export class TaskFolderService {
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

  private async decryptRecord(record: TaskFolderRow): Promise<void> {
    if (!record) return
    const key = this.validateEncryptionKey()
    record.name = (await decryptField(record.name, key)) ?? ''
  }

  async getAll(userId: string): Promise<TaskFolderRow[]> {
    const rows = (await this.db.select().from(schema.taskFolders)
      .where(eq(schema.taskFolders.userId, userId))
      .all()) as unknown as TaskFolderRow[]
    for (const row of rows) {
      await this.decryptRecord(row)
    }
    return rows
  }

  async getById(id: string, userId: string): Promise<TaskFolderRow | undefined> {
    const results = (await this.db.select().from(schema.taskFolders)
      .where(and(eq(schema.taskFolders.id, id), eq(schema.taskFolders.userId, userId)))
      .all()) as unknown as TaskFolderRow[]
    const row = results[0]
    if (row) {
      await this.decryptRecord(row)
    }
    return row
  }

  async create(userId: string, data: CreateTaskFolderRequest): Promise<TaskFolderRow | undefined> {
    const id = crypto.randomUUID()
    const key = this.validateEncryptionKey()
    const encryptedName = await encrypt(data.name.slice(0, 200), key)

    await this.db.insert(schema.taskFolders).values({
      id,
      name: encryptedName,
      sortOrder: data.sortOrder || 0,
      userId
    }).run()

    return this.getById(id, userId)
  }

  async update(id: string, userId: string, data: UpdateTaskFolderRequest): Promise<TaskFolderRow | undefined> {
    const key = this.validateEncryptionKey()
    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (data.name !== undefined) {
      updates.name = await encrypt(data.name.slice(0, 200), key)
    }
    if (data.sortOrder !== undefined) {
      updates.sortOrder = data.sortOrder
    }

    await this.db.update(schema.taskFolders)
      .set(updates)
      .where(and(eq(schema.taskFolders.id, id), eq(schema.taskFolders.userId, userId)))
      .run()

    return this.getById(id, userId)
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.db.delete(schema.taskFolders)
      .where(and(eq(schema.taskFolders.id, id), eq(schema.taskFolders.userId, userId)))
      .run()
  }
}

// ============ 任务清单服务 ============

export class TaskListService {
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

  private async decryptRecord(record: TaskListRow): Promise<void> {
    if (!record) return
    const key = this.validateEncryptionKey()
    record.name = (await decryptField(record.name, key)) ?? ''
    record.color = await decryptField(record.color, key)
    record.icon = await decryptField(record.icon, key)
  }

  async getAll(userId: string): Promise<TaskListRow[]> {
    const rows = (await this.db.select().from(schema.taskLists)
      .where(eq(schema.taskLists.userId, userId))
      .all()) as unknown as TaskListRow[]
    for (const row of rows) {
      await this.decryptRecord(row)
    }
    return rows
  }

  async getById(id: string, userId: string): Promise<TaskListRow | undefined> {
    const results = (await this.db.select().from(schema.taskLists)
      .where(and(eq(schema.taskLists.id, id), eq(schema.taskLists.userId, userId)))
      .all()) as unknown as TaskListRow[]
    const row = results[0]
    if (row) {
      await this.decryptRecord(row)
    }
    return row
  }

  async create(userId: string, data: CreateTaskListRequest): Promise<TaskListRow | undefined> {
    const id = crypto.randomUUID()
    const key = this.validateEncryptionKey()
    const encryptedName = await encrypt(data.name.slice(0, 200), key)
    const color = data.color || '#6366F1'
    const encryptedColor = await encrypt(color, key)
    const encryptedIcon = data.icon ? await encrypt(data.icon.slice(0, 16), key) : null

    await this.db.insert(schema.taskLists).values({
      id,
      name: encryptedName,
      color: encryptedColor,
      icon: encryptedIcon,
      folderId: data.folderId || null,
      sortOrder: data.sortOrder || 0,
      userId
    }).run()

    return this.getById(id, userId)
  }

  async update(id: string, userId: string, data: UpdateTaskListRequest): Promise<TaskListRow | undefined> {
    const key = this.validateEncryptionKey()
    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (data.name !== undefined) {
      updates.name = await encrypt(data.name.slice(0, 200), key)
    }
    if (data.color !== undefined && data.color) {
      updates.color = await encrypt(data.color, key)
    }
    if (data.icon !== undefined) {
      updates.icon = data.icon ? await encrypt(data.icon.slice(0, 16), key) : null
    }
    if (data.folderId !== undefined) {
      updates.folderId = data.folderId || null
    }
    if (data.sortOrder !== undefined) {
      updates.sortOrder = data.sortOrder
    }

    await this.db.update(schema.taskLists)
      .set(updates)
      .where(and(eq(schema.taskLists.id, id), eq(schema.taskLists.userId, userId)))
      .run()

    return this.getById(id, userId)
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.db.delete(schema.taskLists)
      .where(and(eq(schema.taskLists.id, id), eq(schema.taskLists.userId, userId)))
      .run()
  }
}

// ============ 任务服务 ============

export class TaskService {
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

  private async decryptRecord(record: TaskRow): Promise<void> {
    if (!record) return
    const key = this.validateEncryptionKey()
    record.title = (await decryptField(record.title, key)) ?? ''
    record.description = await decryptField(record.description, key)
    record.dueDate = await decryptField(record.dueDate, key)
    record.remindAt = await decryptField(record.remindAt, key)
  }

  async getAll(userId: string): Promise<TaskRow[]> {
    const rows = (await this.db.select().from(schema.tasks)
      .where(eq(schema.tasks.userId, userId))
      .all()) as unknown as TaskRow[]
    for (const row of rows) {
      await this.decryptRecord(row)
    }
    return rows
  }

  async getById(id: string, userId: string): Promise<TaskRow | undefined> {
    const results = (await this.db.select().from(schema.tasks)
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
      .all()) as unknown as TaskRow[]
    const row = results[0]
    if (row) {
      await this.decryptRecord(row)
    }
    return row
  }

  async getByList(listId: string, userId: string): Promise<TaskRow[]> {
    const rows = (await this.db.select().from(schema.tasks)
      .where(and(eq(schema.tasks.listId, listId), eq(schema.tasks.userId, userId)))
      .all()) as unknown as TaskRow[]
    for (const row of rows) {
      await this.decryptRecord(row)
    }
    return rows
  }

  async create(userId: string, data: CreateTaskRequest): Promise<TaskRow | undefined> {
    const id = crypto.randomUUID()
    const key = this.validateEncryptionKey()

    const encryptedTitle = await encrypt(data.title.slice(0, 500), key)
    const encryptedDescription = data.description
      ? await encrypt(data.description.slice(0, 2000), key)
      : null
    const encryptedDueDate = data.dueDate ? await encrypt(data.dueDate, key) : null
    const encryptedRemindAt = data.remindAt ? await encrypt(data.remindAt, key) : null

    const status: TaskStatus = data.status || 'todo'
    const completedAt = status === 'done' ? new Date() : null

    await this.db.insert(schema.tasks).values({
      id,
      title: encryptedTitle,
      description: encryptedDescription,
      listId: data.listId || null,
      priority: data.priority ?? 0,
      status,
      dueDate: encryptedDueDate,
      remindAt: encryptedRemindAt,
      sortOrder: data.sortOrder || 0,
      pinned: data.pinned ? 1 : 0,
      completedAt,
      userId
    }).run()

    // 处理标签关联
    if (Array.isArray(data.tagIds) && data.tagIds.length > 0) {
      await this.syncTaskTags(id, data.tagIds, userId)
    }

    return this.getById(id, userId)
  }

  async update(id: string, userId: string, data: UpdateTaskRequest): Promise<TaskRow | undefined> {
    const key = this.validateEncryptionKey()
    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (data.title !== undefined) {
      updates.title = await encrypt(data.title.slice(0, 500), key)
    }
    if (data.description !== undefined) {
      updates.description = data.description
        ? await encrypt(data.description.slice(0, 2000), key)
        : null
    }
    if (data.listId !== undefined) {
      updates.listId = data.listId || null
    }
    if (data.priority !== undefined) {
      updates.priority = data.priority
    }
    if (data.status !== undefined) {
      updates.status = data.status
      updates.completedAt = data.status === 'done' ? new Date() : null
    }
    if (data.dueDate !== undefined) {
      updates.dueDate = data.dueDate ? await encrypt(data.dueDate, key) : null
    }
    if (data.remindAt !== undefined) {
      updates.remindAt = data.remindAt ? await encrypt(data.remindAt, key) : null
    }
    if (data.sortOrder !== undefined) {
      updates.sortOrder = data.sortOrder
    }
    if (data.pinned !== undefined) {
      updates.pinned = data.pinned ? 1 : 0
    }

    await this.db.update(schema.tasks)
      .set(updates)
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
      .run()

    // 同步标签
    if (Array.isArray(data.tagIds)) {
      await this.syncTaskTags(id, data.tagIds, userId)
    }

    return this.getById(id, userId)
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.db.delete(schema.tasks)
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
      .run()
  }

  /**
   * 同步任务标签（先删除旧的，再插入新的）
   */
  private async syncTaskTags(taskId: string, tagIds: string[], userId: string): Promise<void> {
    await this.db.delete(schema.taskTags)
      .where(and(eq(schema.taskTags.taskId, taskId), eq(schema.taskTags.userId, userId)))
      .run()

    if (tagIds.length === 0) return

    const validTagIds = tagIds.slice(0, 50) // 限制最多 50 个标签
    for (const tagId of validTagIds) {
      const id = crypto.randomUUID()
      await this.db.insert(schema.taskTags).values({
        id,
        taskId,
        tagId,
        userId
      }).run()
    }
  }

  /**
   * 获取任务的所有标签 ID
   */
  async getTaskTagIds(taskId: string, userId: string): Promise<string[]> {
    const rows = (await this.db.select().from(schema.taskTags)
      .where(and(eq(schema.taskTags.taskId, taskId), eq(schema.taskTags.userId, userId)))
      .all()) as unknown as TaskTagRow[]
    return rows.map((r) => r.tagId)
  }
}

// ============ 子任务服务 ============

export class SubtaskService {
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

  private async decryptRecord(record: SubtaskRow): Promise<void> {
    if (!record) return
    const key = this.validateEncryptionKey()
    record.title = (await decryptField(record.title, key)) ?? ''
  }

  async getByTask(taskId: string, userId: string): Promise<SubtaskRow[]> {
    const rows = (await this.db.select().from(schema.subtasks)
      .where(and(eq(schema.subtasks.taskId, taskId), eq(schema.subtasks.userId, userId)))
      .all()) as unknown as SubtaskRow[]
    for (const row of rows) {
      await this.decryptRecord(row)
    }
    return rows
  }

  async getById(id: string, userId: string): Promise<SubtaskRow | undefined> {
    const results = (await this.db.select().from(schema.subtasks)
      .where(and(eq(schema.subtasks.id, id), eq(schema.subtasks.userId, userId)))
      .all()) as unknown as SubtaskRow[]
    const row = results[0]
    if (row) {
      await this.decryptRecord(row)
    }
    return row
  }

  async create(userId: string, data: CreateSubtaskRequest): Promise<SubtaskRow | undefined> {
    const id = crypto.randomUUID()
    const key = this.validateEncryptionKey()
    const encryptedTitle = await encrypt(data.title.slice(0, 500), key)

    await this.db.insert(schema.subtasks).values({
      id,
      taskId: data.taskId,
      title: encryptedTitle,
      status: 'todo',
      sortOrder: data.sortOrder || 0,
      userId
    }).run()

    return this.getById(id, userId)
  }

  async update(id: string, userId: string, data: UpdateSubtaskRequest): Promise<SubtaskRow | undefined> {
    const key = this.validateEncryptionKey()
    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (data.title !== undefined) {
      updates.title = await encrypt(data.title.slice(0, 500), key)
    }
    if (data.status !== undefined) {
      updates.status = data.status
    }
    if (data.sortOrder !== undefined) {
      updates.sortOrder = data.sortOrder
    }

    await this.db.update(schema.subtasks)
      .set(updates)
      .where(and(eq(schema.subtasks.id, id), eq(schema.subtasks.userId, userId)))
      .run()

    return this.getById(id, userId)
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.db.delete(schema.subtasks)
      .where(and(eq(schema.subtasks.id, id), eq(schema.subtasks.userId, userId)))
      .run()
  }
}

// ============ 标签服务 ============

export class TagService {
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

  private async decryptRecord(record: TagRow): Promise<void> {
    if (!record) return
    const key = this.validateEncryptionKey()
    record.name = (await decryptField(record.name, key)) ?? ''
    record.color = await decryptField(record.color, key)
  }

  async getAll(userId: string): Promise<TagRow[]> {
    const rows = (await this.db.select().from(schema.tags)
      .where(eq(schema.tags.userId, userId))
      .all()) as unknown as TagRow[]
    for (const row of rows) {
      await this.decryptRecord(row)
    }
    return rows
  }

  async getById(id: string, userId: string): Promise<TagRow | undefined> {
    const results = (await this.db.select().from(schema.tags)
      .where(and(eq(schema.tags.id, id), eq(schema.tags.userId, userId)))
      .all()) as unknown as TagRow[]
    const row = results[0]
    if (row) {
      await this.decryptRecord(row)
    }
    return row
  }

  async create(userId: string, data: CreateTagRequest): Promise<TagRow | undefined> {
    const id = crypto.randomUUID()
    const key = this.validateEncryptionKey()
    const encryptedName = await encrypt(data.name.slice(0, 100), key)
    const color = data.color || '#6366F1'
    const encryptedColor = await encrypt(color, key)

    await this.db.insert(schema.tags).values({
      id,
      name: encryptedName,
      color: encryptedColor,
      userId
    }).run()

    return this.getById(id, userId)
  }

  async update(id: string, userId: string, data: UpdateTagRequest): Promise<TagRow | undefined> {
    const key = this.validateEncryptionKey()
    const updates: Record<string, unknown> = {}

    if (data.name !== undefined) {
      updates.name = await encrypt(data.name.slice(0, 100), key)
    }
    if (data.color !== undefined && data.color) {
      updates.color = await encrypt(data.color, key)
    }

    if (Object.keys(updates).length > 0) {
      await this.db.update(schema.tags)
        .set(updates)
        .where(and(eq(schema.tags.id, id), eq(schema.tags.userId, userId)))
        .run()
    }

    return this.getById(id, userId)
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.db.delete(schema.tags)
      .where(and(eq(schema.tags.id, id), eq(schema.tags.userId, userId)))
      .run()
  }
}

// ============ 工厂函数 ============

export function createTaskFolderService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey?: string
): TaskFolderService {
  return new TaskFolderService(db, encryptionKey)
}

export function createTaskListService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey?: string
): TaskListService {
  return new TaskListService(db, encryptionKey)
}

export function createTaskService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey?: string
): TaskService {
  return new TaskService(db, encryptionKey)
}

export function createSubtaskService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey?: string
): SubtaskService {
  return new SubtaskService(db, encryptionKey)
}

export function createTagService(
  db: ReturnType<typeof drizzle<typeof schema>>,
  encryptionKey?: string
): TagService {
  return new TagService(db, encryptionKey)
}
