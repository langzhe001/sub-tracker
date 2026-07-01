export interface Env {
  DB?: D1Database
  ASSETS?: Fetcher
  JWT_SECRET?: string
  ENCRYPTION_KEY?: string
  MIGRATION_KEY?: string
}

export interface JwtPayload {
  userId: string
  email: string
}

export type ChannelType = 'email' | 'telegram' | 'feishu' | 'wechat' | 'notifyx'

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface RegisterRequest {
  email: string
  password: string
}

export interface LoginRequest {
  email: string
  password: string
}

export type ExtendMode = 'expire' | 'current'

export interface CreateSubscriptionRequest {
  name: string
  description?: string
  icon?: string
  amount?: number
  currency?: string
  renewalPeriod?: 'monthly' | 'yearly' | 'custom'
  expireDate: string
  reminderDays?: number
  extendMode?: ExtendMode
  customRenewalDays?: number
  groupId?: string
}

export interface UpdateSubscriptionRequest extends Partial<CreateSubscriptionRequest> {}

export interface CreateGroupRequest {
  name: string
  color?: string
  icon?: string
  sortOrder?: number
}

export interface UpdateGroupRequest extends Partial<CreateGroupRequest> {}

export interface CreateChannelRequest {
  type: ChannelType
  name: string
  config: Record<string, string>
  enabled?: boolean
}

export interface UpdateChannelRequest extends Partial<CreateChannelRequest> {}

export interface Stats {
  totalSubscriptions: number
  expiringThisMonth: number
  expiringWithin7Days: number
  expired: number
  totalGroups: number
  totalChannels: number
}

/* =========================================================================
 * 任务管理模块类型（对标滴答清单第一阶段）
 * ========================================================================= */

// 任务优先级：0=无, 1=低, 2=中, 3=高
export type TaskPriority = 0 | 1 | 2 | 3

// 任务状态：todo=待办, done=已完成
export type TaskStatus = 'todo' | 'done'

// 任务排序方式
export type TaskSortBy = 'manual' | 'dueDate' | 'title' | 'priority' | 'createdAt'

export interface CreateTaskFolderRequest {
  name: string
  sortOrder?: number
}

export interface UpdateTaskFolderRequest extends Partial<CreateTaskFolderRequest> {}

export interface CreateTaskListRequest {
  name: string
  color?: string
  icon?: string
  folderId?: string | null
  sortOrder?: number
}

export interface UpdateTaskListRequest extends Partial<CreateTaskListRequest> {}

export interface CreateTaskRequest {
  title: string
  description?: string
  listId?: string | null
  priority?: TaskPriority
  status?: TaskStatus
  dueDate?: string | null
  remindAt?: string | null
  sortOrder?: number
  pinned?: boolean
  tagIds?: string[]
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {}

export interface CreateSubtaskRequest {
  taskId: string
  title: string
  status?: TaskStatus
  sortOrder?: number
}

export interface UpdateSubtaskRequest extends Partial<Omit<CreateSubtaskRequest, 'taskId'>> {}

export interface CreateTagRequest {
  name: string
  color?: string
}

export interface UpdateTagRequest extends Partial<CreateTagRequest> {}

export interface TaskStats {
  totalTasks: number
  completedTasks: number
  pendingTasks: number
  todayDue: number
  overdue: number
  totalLists: number
  totalFolders: number
  totalTags: number
}
