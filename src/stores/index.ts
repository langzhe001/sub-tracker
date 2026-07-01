import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api, type User, type Subscription, type Group, type NotificationChannel, type Stats, type TaskFolder, type TaskList, type Task, type Subtask, type Tag, type TaskStatus } from '@/api/client'

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

/* =========================================================================
 * 任务管理模块 Store
 * ========================================================================= */

// 任务文件夹 Store
export const useTaskFolderStore = defineStore('taskFolders', () => {
  const folders = ref<TaskFolder[]>([])
  const loading = ref(false)

  async function fetchFolders() {
    loading.value = true
    try {
      const res = await api.getTaskFolders()
      if (res.success && res.data) {
        folders.value = res.data
      }
    } finally {
      loading.value = false
    }
  }

  async function createFolder(data: Partial<TaskFolder>) {
    const res = await api.createTaskFolder(data)
    if (res.success && res.data) {
      folders.value.push(res.data)
      return res.data
    }
    return null
  }

  async function updateFolder(id: string, data: Partial<TaskFolder>) {
    const res = await api.updateTaskFolder(id, data)
    if (res.success && res.data) {
      const idx = folders.value.findIndex(f => f.id === id)
      if (idx !== -1) folders.value[idx] = res.data
      return res.data
    }
    return null
  }

  async function deleteFolder(id: string) {
    const res = await api.deleteTaskFolder(id)
    if (res.success) {
      folders.value = folders.value.filter(f => f.id !== id)
      return true
    }
    return false
  }

  return { folders, loading, fetchFolders, createFolder, updateFolder, deleteFolder }
})

// 任务清单 Store
export const useTaskListStore = defineStore('taskLists', () => {
  const lists = ref<TaskList[]>([])
  const loading = ref(false)

  async function fetchLists() {
    loading.value = true
    try {
      const res = await api.getTaskLists()
      if (res.success && res.data) {
        lists.value = res.data
      }
    } finally {
      loading.value = false
    }
  }

  async function createList(data: Partial<TaskList>) {
    const res = await api.createTaskList(data)
    if (res.success && res.data) {
      lists.value.push(res.data)
      return res.data
    }
    return null
  }

  async function updateList(id: string, data: Partial<TaskList>) {
    const res = await api.updateTaskList(id, data)
    if (res.success && res.data) {
      const idx = lists.value.findIndex(l => l.id === id)
      if (idx !== -1) lists.value[idx] = res.data
      return res.data
    }
    return null
  }

  async function deleteList(id: string) {
    const res = await api.deleteTaskList(id)
    if (res.success) {
      lists.value = lists.value.filter(l => l.id !== id)
      return true
    }
    return false
  }

  return { lists, loading, fetchLists, createList, updateList, deleteList }
})

// 任务 Store
export const useTaskStore = defineStore('tasks', () => {
  const tasks = ref<Task[]>([])
  const loading = ref(false)

  async function fetchTasks(listId?: string, status?: TaskStatus) {
    loading.value = true
    try {
      const res = await api.getTasks(listId, status)
      if (res.success && res.data) {
        tasks.value = res.data
      }
    } finally {
      loading.value = false
    }
  }

  async function createTask(data: Partial<Task> & { tagIds?: string[] }) {
    const res = await api.createTask(data)
    if (res.success && res.data) {
      tasks.value.unshift(res.data)
      return res.data
    }
    return null
  }

  async function updateTask(id: string, data: Partial<Task> & { tagIds?: string[] }) {
    const res = await api.updateTask(id, data)
    if (res.success && res.data) {
      const idx = tasks.value.findIndex(t => t.id === id)
      if (idx !== -1) tasks.value[idx] = res.data
      return res.data
    }
    return null
  }

  async function deleteTask(id: string) {
    const res = await api.deleteTask(id)
    if (res.success) {
      tasks.value = tasks.value.filter(t => t.id !== id)
      return true
    }
    return false
  }

  /**
   * 切换任务完成状态
   */
  async function toggleStatus(task: Task) {
    const newStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done'
    return await updateTask(task.id, { status: newStatus })
  }

  return { tasks, loading, fetchTasks, createTask, updateTask, deleteTask, toggleStatus }
})

// 子任务 Store
export const useSubtaskStore = defineStore('subtasks', () => {
  // key: taskId, value: subtasks
  const subtaskMap = ref<Record<string, Subtask[]>>({})
  const loading = ref(false)

  async function fetchSubtasks(taskId: string) {
    loading.value = true
    try {
      const res = await api.getSubtasks(taskId)
      if (res.success && res.data) {
        subtaskMap.value[taskId] = res.data
      }
    } finally {
      loading.value = false
    }
  }

  async function createSubtask(taskId: string, data: Partial<Subtask>) {
    const res = await api.createSubtask(taskId, data)
    if (res.success && res.data) {
      if (!subtaskMap.value[taskId]) subtaskMap.value[taskId] = []
      subtaskMap.value[taskId].push(res.data)
      return res.data
    }
    return null
  }

  async function updateSubtask(taskId: string, id: string, data: Partial<Subtask>) {
    const res = await api.updateSubtask(id, data)
    if (res.success && res.data) {
      const arr = subtaskMap.value[taskId]
      if (arr) {
        const idx = arr.findIndex(s => s.id === id)
        if (idx !== -1) arr[idx] = res.data
      }
      return res.data
    }
    return null
  }

  async function deleteSubtask(taskId: string, id: string) {
    const res = await api.deleteSubtask(id)
    if (res.success) {
      const arr = subtaskMap.value[taskId]
      if (arr) subtaskMap.value[taskId] = arr.filter(s => s.id !== id)
      return true
    }
    return false
  }

  function getSubtasks(taskId: string): Subtask[] {
    return subtaskMap.value[taskId] || []
  }

  return { subtaskMap, loading, fetchSubtasks, createSubtask, updateSubtask, deleteSubtask, getSubtasks }
})

// 标签 Store
export const useTagStore = defineStore('tags', () => {
  const tags = ref<Tag[]>([])
  const loading = ref(false)

  async function fetchTags() {
    loading.value = true
    try {
      const res = await api.getTags()
      if (res.success && res.data) {
        tags.value = res.data
      }
    } finally {
      loading.value = false
    }
  }

  async function createTag(data: Partial<Tag>) {
    const res = await api.createTag(data)
    if (res.success && res.data) {
      tags.value.push(res.data)
      return res.data
    }
    return null
  }

  async function updateTag(id: string, data: Partial<Tag>) {
    const res = await api.updateTag(id, data)
    if (res.success && res.data) {
      const idx = tags.value.findIndex(t => t.id === id)
      if (idx !== -1) tags.value[idx] = res.data
      return res.data
    }
    return null
  }

  async function deleteTag(id: string) {
    const res = await api.deleteTag(id)
    if (res.success) {
      tags.value = tags.value.filter(t => t.id !== id)
      return true
    }
    return false
  }

  return { tags, loading, fetchTags, createTag, updateTag, deleteTag }
})
