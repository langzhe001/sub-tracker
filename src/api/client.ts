interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

interface User {
  id: string
  email: string
  createdAt?: string
}

interface Subscription {
  id: string
  name: string
  description?: string
  icon?: string
  amount?: number
  currency?: string
  renewalPeriod?: 'monthly' | 'yearly' | 'custom'
  expireDate: string
  reminderDays: number
  extendMode?: 'expire' | 'current'
  groupId?: string
  userId: string
  createdAt?: string
  updatedAt?: string
}

interface Group {
  id: string
  name: string
  color: string
  icon?: string
  sortOrder: number
  userId: string
  createdAt?: string
}

type ChannelType = 'email' | 'telegram' | 'feishu' | 'wechat' | 'notifyx'

interface NotificationChannel {
  id: string
  type: ChannelType
  name: string
  config: Record<string, string>
  enabled: boolean
  userId: string
  createdAt?: string
}

interface Stats {
  totalSubscriptions: number
  expiringThisMonth: number
  expiringWithin7Days: number
  expired: number
  totalGroups: number
  totalChannels: number
}

interface NotificationLog {
  id: string
  subscriptionId: string
  subscriptionName: string
  channelId: string
  channelType: string
  success: boolean
  errorMessage?: string
  sentAt: string
}

interface SubscriptionTestResultItem {
  channelName: string
  channelType: string
  success: boolean
  error?: string
}

interface SubscriptionTestResult {
  results: SubscriptionTestResultItem[]
  total: number
  success: number
  failed: number
}

const API_BASE = '/api'

class ApiClient {
  private token: string | null = null

  setToken(token: string | null) {
    this.token = token
    if (token) {
      localStorage.setItem('token', token)
    } else {
      localStorage.removeItem('token')
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('token')
    }
    return this.token
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {})
    }

    const token = this.getToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
      })

      const data = await response.json() as ApiResponse<T>
      return data
    } catch (error) {
      return { success: false, error: String(error) } as ApiResponse<T>
    }
  }

  async register(email: string, password: string) {
    const res = await this.request<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    })
    if (res.success && res.data) {
      this.setToken(res.data.token)
    }
    return res
  }

  async login(email: string, password: string) {
    const res = await this.request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    })
    if (res.success && res.data) {
      this.setToken(res.data.token)
    }
    return res
  }

  async logout() {
    this.setToken(null)
  }

  async getMe() {
    return this.request<Omit<User, 'id' | 'email'>>('/auth/me')
  }

  async getSubscriptions(groupId?: string) {
    const query = groupId ? `?groupId=${groupId}` : ''
    return this.request<Subscription[]>(`/subscriptions${query}`)
  }

  async getSubscription(id: string) {
    return this.request<Subscription>(`/subscriptions/${id}`)
  }

  async createSubscription(data: Partial<Subscription>) {
    return this.request<Subscription>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async updateSubscription(id: string, data: Partial<Subscription>) {
    return this.request<Subscription>(`/subscriptions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  }

  async deleteSubscription(id: string) {
    return this.request<void>(`/subscriptions/${id}`, {
      method: 'DELETE'
    })
  }

  /**
   * 一键续期：按订阅的 extendMode 与 renewalPeriod 推后到期日期
   */
  async extendSubscription(id: string) {
    return this.request<Subscription>(`/subscriptions/${id}/extend`, {
      method: 'POST'
    })
  }

  /**
   * 测试推送：使用订阅真实数据向所有启用的通知渠道发送测试通知
   */
  async testSubscription(id: string): Promise<ApiResponse<SubscriptionTestResult>> {
    return this.request<SubscriptionTestResult>(`/subscriptions/${id}/test`, {
      method: 'POST'
    })
  }

  async getStats() {
    return this.request<Stats>('/subscriptions/stats')
  }

  async getGroups() {
    return this.request<Group[]>('/groups')
  }

  async createGroup(data: Partial<Group>) {
    return this.request<Group>('/groups', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async updateGroup(id: string, data: Partial<Group>) {
    return this.request<Group>(`/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  }

  async deleteGroup(id: string) {
    return this.request<void>(`/groups/${id}`, {
      method: 'DELETE'
    })
  }

  async getChannels() {
    return this.request<NotificationChannel[]>('/channels')
  }

  async getChannel(id: string) {
    return this.request<NotificationChannel>(`/channels/${id}`)
  }

  async createChannel(data: Partial<NotificationChannel>) {
    return this.request<NotificationChannel>('/channels', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async updateChannel(id: string, data: Partial<NotificationChannel>) {
    return this.request<NotificationChannel>(`/channels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  }

  async deleteChannel(id: string) {
    return this.request<void>(`/channels/${id}`, {
      method: 'DELETE'
    })
  }

  async testChannel(id: string): Promise<ApiResponse<{ success: boolean; error?: string }>> {
    return this.request<{ success: boolean; error?: string }>(`/channels/${id}/test`, {
      method: 'POST'
    })
  }

  async getNotificationLogs(limit: number = 50) {
    return this.request<NotificationLog[]>(`/notifications?limit=${limit}`)
  }
}

export const api = new ApiClient()

export type {
  ApiResponse,
  User,
  Subscription,
  Group,
  NotificationChannel,
  Stats,
  NotificationLog,
  SubscriptionTestResult,
  ChannelType
}
