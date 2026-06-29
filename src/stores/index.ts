import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api, type User, type Subscription, type Group, type NotificationChannel, type Stats } from '@/api/client'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(api.getToken())
  const user = ref<User | null>(null)
  const loading = ref(false)

  const isAuthenticated = computed(() => !!token.value)

  async function login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    loading.value = true
    try {
      const res = await api.login(email, password)
      if (res.success && res.data) {
        token.value = res.data.token
        user.value = res.data.user
        return { success: true }
      }
      return { success: false, error: res.error || '登录失败，请检查邮箱和密码' }
    } catch {
      return { success: false, error: '网络错误，请稍后重试' }
    } finally {
      loading.value = false
    }
  }

  async function register(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    loading.value = true
    try {
      const res = await api.register(email, password)
      if (res.success && res.data) {
        token.value = res.data.token
        user.value = res.data.user
        return { success: true }
      }
      return { success: false, error: res.error || '注册失败' }
    } catch {
      return { success: false, error: '网络错误，请稍后重试' }
    } finally {
      loading.value = false
    }
  }

  function logout() {
    token.value = null
    user.value = null
    api.logout()
  }

  async function fetchUser() {
    if (!token.value) return
    const res = await api.getMe()
    if (res.success && res.data) {
      user.value = res.data as User
    }
  }

  return {
    token,
    user,
    loading,
    isAuthenticated,
    login,
    register,
    logout,
    fetchUser
  }
})

export const useSubscriptionStore = defineStore('subscriptions', () => {
  const subscriptions = ref<Subscription[]>([])
  const stats = ref<Stats | null>(null)
  const loading = ref(false)

  async function fetchSubscriptions(groupId?: string) {
    loading.value = true
    try {
      const res = await api.getSubscriptions(groupId)
      if (res.success && res.data) {
        subscriptions.value = res.data
      }
    } finally {
      loading.value = false
    }
  }

  async function fetchStats() {
    const res = await api.getStats()
    if (res.success && res.data) {
      stats.value = res.data
    }
  }

  async function createSubscription(data: Partial<Subscription>) {
    const res = await api.createSubscription(data)
    if (res.success && res.data) {
      subscriptions.value.push(res.data)
      await fetchStats()
      return res.data
    }
    return null
  }

  async function updateSubscription(id: string, data: Partial<Subscription>) {
    const res = await api.updateSubscription(id, data)
    if (res.success && res.data) {
      const index = subscriptions.value.findIndex(s => s.id === id)
      if (index !== -1) {
        subscriptions.value[index] = res.data
      }
      await fetchStats()
      return res.data
    }
    return null
  }

  async function deleteSubscription(id: string) {
    const res = await api.deleteSubscription(id)
    if (res.success) {
      subscriptions.value = subscriptions.value.filter(s => s.id !== id)
      await fetchStats()
      return true
    }
    return false
  }

  return {
    subscriptions,
    stats,
    loading,
    fetchSubscriptions,
    fetchStats,
    createSubscription,
    updateSubscription,
    deleteSubscription
  }
})

export const useGroupStore = defineStore('groups', () => {
  const groups = ref<Group[]>([])
  const loading = ref(false)

  async function fetchGroups() {
    loading.value = true
    try {
      const res = await api.getGroups()
      if (res.success && res.data) {
        groups.value = res.data
      }
    } finally {
      loading.value = false
    }
  }

  async function createGroup(data: Partial<Group>) {
    const res = await api.createGroup(data)
    if (res.success && res.data) {
      groups.value.push(res.data)
      return res.data
    }
    return null
  }

  async function updateGroup(id: string, data: Partial<Group>) {
    const res = await api.updateGroup(id, data)
    if (res.success && res.data) {
      const index = groups.value.findIndex(g => g.id === id)
      if (index !== -1) {
        groups.value[index] = res.data
      }
      return res.data
    }
    return null
  }

  async function deleteGroup(id: string) {
    const res = await api.deleteGroup(id)
    if (res.success) {
      groups.value = groups.value.filter(g => g.id !== id)
      return true
    }
    return false
  }

  return {
    groups,
    loading,
    fetchGroups,
    createGroup,
    updateGroup,
    deleteGroup
  }
})

export const useChannelStore = defineStore('channels', () => {
  const channels = ref<NotificationChannel[]>([])
  const loading = ref(false)

  async function fetchChannels() {
    loading.value = true
    try {
      const res = await api.getChannels()
      if (res.success && res.data) {
        channels.value = res.data
      }
    } finally {
      loading.value = false
    }
  }

  async function createChannel(data: Partial<NotificationChannel>) {
    const res = await api.createChannel(data)
    if (res.success && res.data) {
      channels.value.push(res.data)
      return res.data
    }
    return null
  }

  async function updateChannel(id: string, data: Partial<NotificationChannel>) {
    const res = await api.updateChannel(id, data)
    if (res.success && res.data) {
      const index = channels.value.findIndex(c => c.id === id)
      if (index !== -1) {
        channels.value[index] = res.data
      }
      return res.data
    }
    return null
  }

  async function deleteChannel(id: string) {
    const res = await api.deleteChannel(id)
    if (res.success) {
      channels.value = channels.value.filter(c => c.id !== id)
      return true
    }
    return false
  }

  async function testChannel(id: string) {
    return await api.testChannel(id)
  }

  return {
    channels,
    loading,
    fetchChannels,
    createChannel,
    updateChannel,
    deleteChannel,
    testChannel
  }
})
