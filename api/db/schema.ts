import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// users.email 存储 AES-GCM 加密后的密文（随机 IV，无法直接查询）
// users.emailHash 存储 HMAC-SHA256 哈希（确定性，用于登录/注册时的邮箱等值查询）
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  emailHash: text('email_hash').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
})

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').default('#6366F1'),
  icon: text('icon'),
  sortOrder: integer('sort_order').default(0),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
})

// 敏感字段（name/description/icon/amount/currency/renewalPeriod/expireDate/reminderDays/extendMode/customRenewalDays）
// 全部以 AES-GCM 密文存储；expireDate 范围查询改为应用层过滤（先按 userId 取全部，再解密过滤）
// extendMode 仅周期模式使用：expire=以到期日延续 / current=以当前日期延续
// customRenewalDays：续费周期为 custom 时的自定义天数，续期时按此天数推后
export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon'),
  amount: text('amount'),
  currency: text('currency').default('CNY'),
  renewalPeriod: text('renewal_period').default('monthly'),
  expireDate: text('expire_date').notNull(),
  reminderDays: text('reminder_days').default('7'),
  extendMode: text('extend_mode').default('expire'),
  customRenewalDays: text('custom_renewal_days').default('30'),
  groupId: text('group_id').references(() => groups.id, { onDelete: 'set null' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
})

export const notificationChannels = sqliteTable('notification_channels', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  config: text('config').notNull(),
  enabled: integer('enabled').default(1),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
})

export const notificationLogs = sqliteTable('notification_logs', {
  id: text('id').primaryKey(),
  subscriptionId: text('subscription_id').notNull().references(() => subscriptions.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull().references(() => notificationChannels.id, { onDelete: 'cascade' }),
  channelType: text('channel_type').notNull(),
  success: integer('success').default(0),
  errorMessage: text('error_message'),
  sentAt: integer('sent_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
})

/* =========================================================================
 * 任务管理模块（对标滴答清单 - 第一阶段：任务管理基础）
 * 包括：文件夹、清单、任务、子任务、标签
 * 敏感字段（name/title/description/dueDate/remindAt）同样使用 AES-GCM 加密存储
 * ========================================================================= */

// 任务文件夹：用于组织多个清单
export const taskFolders = sqliteTable('task_folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').default(0),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
})

// 任务清单：组织任务的容器，可属于某个文件夹
export const taskLists = sqliteTable('task_lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').default('#6366F1'),
  icon: text('icon'),
  folderId: text('folder_id').references(() => taskFolders.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').default(0),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
})

// 任务：核心实体
// priority: 0=无, 1=低, 2=中, 3=高
// status: 'todo' | 'done'
// dueDate: YYYY-MM-DD（可空）
// remindAt: ISO datetime（可空，用于触发提醒）
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  listId: text('list_id').references(() => taskLists.id, { onDelete: 'cascade' }),
  priority: integer('priority').default(0),
  status: text('status').default('todo'),
  dueDate: text('due_date'),
  remindAt: text('remind_at'),
  sortOrder: integer('sort_order').default(0),
  pinned: integer('pinned').default(0),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
})

// 子任务：归属于某个任务
export const subtasks = sqliteTable('subtasks', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').default('todo'),
  sortOrder: integer('sort_order').default(0),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
})

// 标签：用于跨清单分类任务
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').default('#6366F1'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
})

// 任务-标签关联表（多对多）
export const taskTags = sqliteTable('task_tags', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
})

export type User = typeof users.$inferSelect
export type Group = typeof groups.$inferSelect
export type Subscription = typeof subscriptions.$inferSelect
export type NotificationChannel = typeof notificationChannels.$inferSelect
export type NotificationLog = typeof notificationLogs.$inferSelect
export type TaskFolder = typeof taskFolders.$inferSelect
export type TaskList = typeof taskLists.$inferSelect
export type Task = typeof tasks.$inferSelect
export type Subtask = typeof subtasks.$inferSelect
export type Tag = typeof tags.$inferSelect
export type TaskTag = typeof taskTags.$inferSelect
