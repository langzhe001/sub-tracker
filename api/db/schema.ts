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

// 敏感字段（name/description/icon/amount/currency/renewalPeriod/expireDate/reminderDays）
// 全部以 AES-GCM 密文存储；expireDate 范围查询改为应用层过滤（先按 userId 取全部，再解密过滤）
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

export type User = typeof users.$inferSelect
export type Group = typeof groups.$inferSelect
export type Subscription = typeof subscriptions.$inferSelect
export type NotificationChannel = typeof notificationChannels.$inferSelect
export type NotificationLog = typeof notificationLogs.$inferSelect
