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

export interface CreateSubscriptionRequest {
  name: string
  description?: string
  icon?: string
  amount?: number
  currency?: string
  renewalPeriod?: 'monthly' | 'yearly' | 'custom'
  expireDate: string
  reminderDays?: number
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
