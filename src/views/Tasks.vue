<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import {
  useTaskStore,
  useTaskListStore,
  useTaskFolderStore,
  useTagStore,
  useSubtaskStore
} from '@/stores'
import { api } from '@/api/client'
import type { Task, TaskList, Tag, Subtask, TaskStatus, TaskPriority } from '@/api/client'
import {
  Plus, Search, Calendar, Flag, Tag as TagIcon, ListTodo,
  CheckCircle2, Circle, ChevronDown, ChevronRight, Pin, PinOff,
  Edit2, Trash2, Folder, Inbox, Star, X, AlignLeft, Clock,
  ListChecks, FolderPlus, Hash
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

const taskStore = useTaskStore()
const listStore = useTaskListStore()
const folderStore = useTaskFolderStore()
const tagStore = useTagStore()
const subtaskStore = useSubtaskStore()

// 视图状态
type FilterType = 'all' | 'today' | 'done' | 'list' | 'tag'
const currentFilter = ref<{ type: FilterType; id?: string; name: string }>({
  type: 'all',
  name: '全部任务'
})
const sortBy = ref<'manual' | 'dueDate' | 'priority' | 'title' | 'createdAt'>('createdAt')
const searchQuery = ref('')
const showCompleted = ref(true)

// 快速添加
const quickAddText = ref('')
const quickAdding = ref(false)

// 任务详情对话框
const showTaskDetail = ref(false)
const editingTask = ref<Task | null>(null)
const editForm = ref({
  title: '',
  description: '',
  listId: '' as string | null,
  priority: 0 as TaskPriority,
  dueDate: '',
  remindAt: '',
  pinned: false,
  tagIds: [] as string[]
})

// 子任务输入
const newSubtaskTitle = ref('')

// 列表/文件夹管理对话框
const showListManager = ref(false)
const newListName = ref('')
const newListColor = ref('#6366F1')
const newListFolderId = ref<string | null>(null)
const newFolderName = ref('')

// 标签管理
const showTagManager = ref(false)
const newTagName = ref('')
const newTagColor = ref('#6366F1')

// 删除确认
const deleteTarget = ref<{ type: 'task' | 'list' | 'folder' | 'tag'; id: string; name: string } | null>(null)

// 颜色预设
const COLOR_PRESETS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#EF4444',
  '#F59E0B', '#10B981', '#3B82F6', '#6B7280'
]

onMounted(async () => {
  await Promise.all([
    taskStore.fetchTasks(),
    listStore.fetchLists(),
    folderStore.fetchFolders(),
    tagStore.fetchTags()
  ])
})

// 监听筛选变化，重新加载任务
watch(currentFilter, async (filter) => {
  if (filter.type === 'list' && filter.id) {
    await taskStore.fetchTasks(filter.id)
  } else if (filter.type === 'done') {
    await taskStore.fetchTasks(undefined, 'done')
  } else {
    await taskStore.fetchTasks()
  }
}, { deep: true })

// 过滤后的任务（应用搜索、排序、显示完成状态）
const filteredTasks = computed(() => {
  let result = [...taskStore.tasks]

  // 搜索
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.description?.toLowerCase().includes(q))
    )
  }

  // 今天到期
  if (currentFilter.value.type === 'today') {
    const today = new Date().toISOString().split('T')[0]
    result = result.filter(t => t.dueDate === today && t.status === 'todo')
  }

  // 标签过滤
  if (currentFilter.value.type === 'tag' && currentFilter.value.id) {
    result = result.filter(t => t.tagIds?.includes(currentFilter.value.id!))
  }

  // 隐藏已完成（除非筛选 done 或 showCompleted）
  if (currentFilter.value.type !== 'done' && !showCompleted.value) {
    result = result.filter(t => t.status !== 'done')
  }

  // 排序
  result.sort((a, b) => {
    // 置顶优先
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    // 未完成优先
    if (a.status !== b.status) return a.status === 'todo' ? -1 : 1

    switch (sortBy.value) {
      case 'dueDate': {
        if (!a.dueDate && !b.dueDate) return 0
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return a.dueDate.localeCompare(b.dueDate)
      }
      case 'priority':
        return (b.priority || 0) - (a.priority || 0)
      case 'title':
        return a.title.localeCompare(b.title)
      case 'manual':
        return (a.sortOrder || 0) - (b.sortOrder || 0)
      case 'createdAt':
      default:
        return (b.createdAt || '').localeCompare(a.createdAt || '')
    }
  })

  return result
})

// 统计
const stats = computed(() => {
  const all = taskStore.tasks
  const today = new Date().toISOString().split('T')[0]
  return {
    total: all.length,
    done: all.filter(t => t.status === 'done').length,
    today: all.filter(t => t.dueDate === today && t.status === 'todo').length,
    pending: all.filter(t => t.status === 'todo').length
  }
})

// 优先级颜色
function priorityColor(p: TaskPriority): string {
  switch (p) {
    case 3: return '#EF4444'  // 高 - 红
    case 2: return '#F59E0B'  // 中 - 黄
    case 1: return '#3B82F6'  // 低 - 蓝
    default: return 'transparent'
  }
}

function priorityLabel(p: TaskPriority): string {
  return ['无', '低', '中', '高'][p] || '无'
}

// 标签查找
function getTag(id: string): Tag | undefined {
  return tagStore.tags.find(t => t.id === id)
}

function getList(id?: string | null): TaskList | undefined {
  if (!id) return undefined
  return listStore.lists.find(l => l.id === id)
}

// 日期格式化
function formatDate(date?: string | null): string {
  if (!date) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  if (isNaN(target.getTime())) return date
  const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  if (diff > 0 && diff <= 7) return `${diff} 天后`
  if (diff < 0) return `逾期 ${Math.abs(diff)} 天`
  const m = target.getMonth() + 1
  const d = target.getDate()
  return `${m}月${d}日`
}

function isOverdue(date?: string | null, status?: string): boolean {
  if (!date || status === 'done') return false
  const today = new Date().toISOString().split('T')[0]
  return date < today
}

// 智能识别日期（简单版：识别"今天/明天/后天/X月X日/X号"）
function parseSmartDate(text: string): { title: string; dueDate: string | null } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let dueDate: string | null = null
  let title = text

  // 今天
  if (/今天|today/i.test(text)) {
    dueDate = today.toISOString().split('T')[0]
    title = title.replace(/今天|today/gi, '').trim()
  }
  // 明天
  else if (/明天|tomorrow/i.test(text)) {
    const d = new Date(today)
    d.setDate(d.getDate() + 1)
    dueDate = d.toISOString().split('T')[0]
    title = title.replace(/明天|tomorrow/gi, '').trim()
  }
  // 后天
  else if (/后天/.test(text)) {
    const d = new Date(today)
    d.setDate(d.getDate() + 2)
    dueDate = d.toISOString().split('T')[0]
    title = title.replace(/后天/g, '').trim()
  }
  // X月X日/X号
  else {
    const m = text.match(/(\d{1,2})月(\d{1,2})[日号]/)
    if (m) {
      const month = Number(m[1])
      const day = Number(m[2])
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        let year = today.getFullYear()
        const d = new Date(year, month - 1, day)
        if (d < today) year += 1
        dueDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        title = title.replace(/\d{1,2}月\d{1,2}[日号]/, '').trim()
      }
    }
  }

  return { title, dueDate }
}

// 快速添加任务
async function quickAdd() {
  const text = quickAddText.value.trim()
  if (!text) return
  quickAdding.value = true
  try {
    const { title, dueDate } = parseSmartDate(text)
    await taskStore.createTask({
      title: title || text,
      dueDate,
      priority: 0,
      status: 'todo',
      listId: currentFilter.value.type === 'list' ? currentFilter.value.id : null
    })
    quickAddText.value = ''
  } finally {
    quickAdding.value = false
  }
}

// 切换完成状态
async function toggleTask(task: Task) {
  await taskStore.toggleStatus(task)
}

// 切换置顶
async function togglePin(task: Task) {
  await taskStore.updateTask(task.id, { pinned: !task.pinned })
}

// 打开任务详情
async function openTaskDetail(task: Task) {
  editingTask.value = task
  editForm.value = {
    title: task.title,
    description: task.description || '',
    listId: task.listId || null,
    priority: task.priority,
    dueDate: task.dueDate || '',
    remindAt: task.remindAt ? task.remindAt.slice(0, 16) : '',
    pinned: task.pinned,
    tagIds: task.tagIds || []
  }
  // 加载子任务
  await subtaskStore.fetchSubtasks(task.id)
  showTaskDetail.value = true
}

// 保存任务详情
async function saveTaskDetail() {
  if (!editingTask.value) return
  await taskStore.updateTask(editingTask.value.id, {
    title: editForm.value.title,
    description: editForm.value.description,
    listId: editForm.value.listId || null,
    priority: editForm.value.priority,
    dueDate: editForm.value.dueDate || null,
    remindAt: editForm.value.remindAt || null,
    pinned: editForm.value.pinned,
    tagIds: editForm.value.tagIds
  })
  showTaskDetail.value = false
  editingTask.value = null
}

// 切换标签选中
function toggleTagSelection(tagId: string) {
  const idx = editForm.value.tagIds.indexOf(tagId)
  if (idx === -1) {
    editForm.value.tagIds.push(tagId)
  } else {
    editForm.value.tagIds.splice(idx, 1)
  }
}

// 子任务操作
async function addSubtask() {
  if (!editingTask.value || !newSubtaskTitle.value.trim()) return
  await subtaskStore.createSubtask(editingTask.value.id, {
    title: newSubtaskTitle.value.trim(),
    status: 'todo'
  })
  newSubtaskTitle.value = ''
}

async function toggleSubtask(sub: Subtask) {
  if (!editingTask.value) return
  const newStatus: TaskStatus = sub.status === 'done' ? 'todo' : 'done'
  await subtaskStore.updateSubtask(editingTask.value.id, sub.id, { status: newStatus })
}

async function deleteSubtask(sub: Subtask) {
  if (!editingTask.value) return
  await subtaskStore.deleteSubtask(editingTask.value.id, sub.id)
}

// 列表管理
async function createList() {
  if (!newListName.value.trim()) return
  await listStore.createList({
    name: newListName.value.trim(),
    color: newListColor.value,
    folderId: newListFolderId.value
  })
  newListName.value = ''
  newListColor.value = '#6366F1'
}

async function createFolder() {
  if (!newFolderName.value.trim()) return
  await folderStore.createFolder({ name: newFolderName.value.trim() })
  newFolderName.value = ''
}

async function createTag() {
  if (!newTagName.value.trim()) return
  await tagStore.createTag({
    name: newTagName.value.trim(),
    color: newTagColor.value
  })
  newTagName.value = ''
  newTagColor.value = '#6366F1'
}

// 删除操作
async function confirmDelete() {
  if (!deleteTarget.value) return
  const t = deleteTarget.value
  if (t.type === 'task') {
    await taskStore.deleteTask(t.id)
    if (editingTask.value?.id === t.id) {
      showTaskDetail.value = false
      editingTask.value = null
    }
  } else if (t.type === 'list') {
    await listStore.deleteList(t.id)
    if (currentFilter.value.type === 'list' && currentFilter.value.id === t.id) {
      currentFilter.value = { type: 'all', name: '全部任务' }
    }
  } else if (t.type === 'folder') {
    await folderStore.deleteFolder(t.id)
  } else if (t.type === 'tag') {
    await tagStore.deleteTag(t.id)
    if (currentFilter.value.type === 'tag' && currentFilter.value.id === t.id) {
      currentFilter.value = { type: 'all', name: '全部任务' }
    }
  }
  deleteTarget.value = null
}

// 展开/折叠文件夹
const expandedFolders = ref<Set<string>>(new Set())
function toggleFolder(folderId: string) {
  if (expandedFolders.value.has(folderId)) {
    expandedFolders.value.delete(folderId)
  } else {
    expandedFolders.value.add(folderId)
  }
}

// 按文件夹分组清单
const listsByFolder = computed(() => {
  const grouped: Record<string, TaskList[]> = {}
  const noFolder: TaskList[] = []
  for (const list of listStore.lists) {
    if (list.folderId) {
      if (!grouped[list.folderId]) grouped[list.folderId] = []
      grouped[list.folderId].push(list)
    } else {
      noFolder.push(list)
    }
  }
  return { grouped, noFolder }
})

// 子任务进度
function subtaskProgress(taskId: string): { total: number; done: number } {
  const subs = subtaskStore.getSubtasks(taskId)
  return {
    total: subs.length,
    done: subs.filter(s => s.status === 'done').length
  }
}
</script>

<template>
  <div class="animate-fade-in h-full flex gap-4 md:gap-6">
    <!-- 左侧边栏：清单/文件夹/标签 -->
    <aside class="hidden lg:flex w-64 shrink-0 flex-col">
      <Card class="flex flex-col h-[calc(100vh-8rem)] sticky top-4">
        <CardHeader class="pb-3 border-b">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-base">任务清单</h2>
            <Button variant="ghost" size="icon" class="h-7 w-7" @click="showListManager = true">
              <Plus class="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent class="flex-1 overflow-y-auto p-2 space-y-1">
          <!-- 全部任务 -->
          <button
            class="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors"
            :class="currentFilter.type === 'all' ? 'bg-secondary' : 'hover:bg-accent'"
            @click="currentFilter = { type: 'all', name: '全部任务' }"
          >
            <div class="flex items-center gap-2">
              <Inbox class="w-4 h-4 text-primary" />
              <span>全部任务</span>
            </div>
            <span class="text-xs text-muted-foreground">{{ stats.total }}</span>
          </button>

          <!-- 今天 -->
          <button
            class="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors"
            :class="currentFilter.type === 'today' ? 'bg-secondary' : 'hover:bg-accent'"
            @click="currentFilter = { type: 'today', name: '今天' }"
          >
            <div class="flex items-center gap-2">
              <Calendar class="w-4 h-4 text-orange-500" />
              <span>今天</span>
            </div>
            <span class="text-xs text-muted-foreground">{{ stats.today }}</span>
          </button>

          <!-- 已完成 -->
          <button
            class="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors"
            :class="currentFilter.type === 'done' ? 'bg-secondary' : 'hover:bg-accent'"
            @click="currentFilter = { type: 'done', name: '已完成' }"
          >
            <div class="flex items-center gap-2">
              <CheckCircle2 class="w-4 h-4 text-green-500" />
              <span>已完成</span>
            </div>
            <span class="text-xs text-muted-foreground">{{ stats.done }}</span>
          </button>

          <div class="h-px bg-border my-2" />

          <!-- 文件夹与清单 -->
          <div class="space-y-1">
            <!-- 无文件夹的清单 -->
            <button
              v-for="list in listsByFolder.noFolder"
              :key="list.id"
              class="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors"
              :class="currentFilter.type === 'list' && currentFilter.id === list.id ? 'bg-secondary' : 'hover:bg-accent'"
              @click="currentFilter = { type: 'list', id: list.id, name: list.name }"
            >
              <div class="flex items-center gap-2 min-w-0">
                <ListTodo class="w-4 h-4 shrink-0" :style="{ color: list.color }" />
                <span class="truncate">{{ list.name }}</span>
              </div>
            </button>

            <!-- 文件夹 -->
            <div v-for="folder in folderStore.folders" :key="folder.id">
              <button
                class="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent"
                @click="toggleFolder(folder.id)"
              >
                <component
                  :is="expandedFolders.has(folder.id) ? ChevronDown : ChevronRight"
                  class="w-4 h-4 text-muted-foreground"
                />
                <Folder class="w-4 h-4 text-muted-foreground" />
                <span class="truncate flex-1 text-left">{{ folder.name }}</span>
              </button>
              <div v-if="expandedFolders.has(folder.id)" class="ml-4 space-y-1">
                <button
                  v-for="list in listsByFolder.grouped[folder.id] || []"
                  :key="list.id"
                  class="w-full flex items-center justify-between px-3 py-1.5 rounded-md text-sm transition-colors"
                  :class="currentFilter.type === 'list' && currentFilter.id === list.id ? 'bg-secondary' : 'hover:bg-accent'"
                  @click="currentFilter = { type: 'list', id: list.id, name: list.name }"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <ListTodo class="w-4 h-4 shrink-0" :style="{ color: list.color }" />
                    <span class="truncate">{{ list.name }}</span>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <div class="h-px bg-border my-2" />

          <!-- 标签 -->
          <div class="space-y-1">
            <div class="px-3 py-1 text-xs text-muted-foreground font-medium flex items-center justify-between">
              <span>标签</span>
              <Button variant="ghost" size="icon" class="h-5 w-5" @click="showTagManager = true">
                <Plus class="w-3 h-3" />
              </Button>
            </div>
            <button
              v-for="tag in tagStore.tags"
              :key="tag.id"
              class="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors"
              :class="currentFilter.type === 'tag' && currentFilter.id === tag.id ? 'bg-secondary' : 'hover:bg-accent'"
              @click="currentFilter = { type: 'tag', id: tag.id, name: tag.name }"
            >
              <Hash class="w-3.5 h-3.5" :style="{ color: tag.color }" />
              <span class="truncate">{{ tag.name }}</span>
            </button>
            <div v-if="tagStore.tags.length === 0" class="px-3 py-2 text-xs text-muted-foreground">
              暂无标签
            </div>
          </div>
        </CardContent>
      </Card>
    </aside>

    <!-- 主内容区 -->
    <main class="flex-1 min-w-0">
      <!-- 顶部标题栏 -->
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3 min-w-0">
          <h1 class="text-xl md:text-2xl font-bold truncate">{{ currentFilter.name }}</h1>
          <Badge variant="secondary" class="shrink-0">{{ filteredTasks.length }}</Badge>
        </div>
        <div class="flex items-center gap-2">
          <select
            v-model="sortBy"
            class="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="createdAt">创建时间</option>
            <option value="dueDate">到期日期</option>
            <option value="priority">优先级</option>
            <option value="title">标题</option>
            <option value="manual">手动排序</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            @click="showCompleted = !showCompleted"
          >
            <ListChecks class="w-4 h-4" />
            {{ showCompleted ? '隐藏完成' : '显示完成' }}
          </Button>
        </div>
      </div>

      <!-- 快速添加 -->
      <Card class="p-3 mb-4">
        <div class="flex items-center gap-2">
          <Plus class="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            v-model="quickAddText"
            type="text"
            placeholder="快速添加任务（支持 今天/明天/X月X日 智能识别日期）..."
            class="flex-1 bg-transparent outline-none text-sm"
            @keydown.enter="quickAdd"
            :disabled="quickAdding"
          />
          <Button
            v-if="quickAddText"
            size="sm"
            :disabled="quickAdding"
            @click="quickAdd"
          >
            添加
          </Button>
        </div>
      </Card>

      <!-- 搜索框 -->
      <div class="relative mb-4">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
        <Input
          v-model="searchQuery"
          type="text"
          placeholder="搜索任务..."
          class="pl-9"
        />
      </div>

      <!-- 任务列表 -->
      <EmptyState
        v-if="filteredTasks.length === 0"
        :icon="ListTodo"
        title="暂无任务"
        description="在上方输入框快速创建第一个任务，或点击 + 添加更多详情。"
      />

      <div v-else class="space-y-2 pb-8">
        <Card
          v-for="task in filteredTasks"
          :key="task.id"
          class="p-3 hover:border-primary/30 transition-all cursor-pointer group"
          :class="{
            'opacity-60': task.status === 'done',
            'border-l-4': task.priority > 0
          }"
          :style="task.priority > 0 ? { borderLeftColor: priorityColor(task.priority) } : {}"
          @click="openTaskDetail(task)"
        >
          <div class="flex items-start gap-3">
            <!-- 完成复选框 -->
            <button
              class="mt-0.5 shrink-0"
              @click.stop="toggleTask(task)"
            >
              <CheckCircle2
                v-if="task.status === 'done'"
                class="w-5 h-5 text-green-500"
              />
              <Circle
                v-else
                class="w-5 h-5 text-muted-foreground hover:text-primary transition-colors"
              />
            </button>

            <!-- 任务内容 -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span
                  class="text-sm font-medium"
                  :class="{ 'line-through text-muted-foreground': task.status === 'done' }"
                >{{ task.title }}</span>
                <Pin
                  v-if="task.pinned"
                  class="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0"
                />
              </div>

              <p
                v-if="task.description"
                class="text-xs text-muted-foreground mt-1 line-clamp-2"
              >{{ task.description }}</p>

              <!-- 标签与元信息 -->
              <div class="flex items-center gap-2 mt-2 flex-wrap">
                <Badge
                  v-if="task.dueDate"
                  :variant="isOverdue(task.dueDate, task.status) ? 'destructive' : 'secondary'"
                  class="text-xs"
                >
                  <Calendar class="w-3 h-3 mr-1" />
                  {{ formatDate(task.dueDate) }}
                </Badge>

                <Badge
                  v-if="task.remindAt"
                  variant="outline"
                  class="text-xs"
                >
                  <Clock class="w-3 h-3 mr-1" />
                  {{ task.remindAt.slice(11, 16) }}
                </Badge>

                <Badge
                  v-for="tid in (task.tagIds || []).slice(0, 3)"
                  :key="tid"
                  variant="outline"
                  class="text-xs"
                  :style="{ color: getTag(tid)?.color, borderColor: getTag(tid)?.color + '40' }"
                >
                  <Hash class="w-3 h-3 mr-1" />
                  {{ getTag(tid)?.name }}
                </Badge>

                <Badge
                  v-if="getList(task.listId)"
                  variant="outline"
                  class="text-xs"
                  :style="{ color: getList(task.listId)?.color }"
                >
                  <ListTodo class="w-3 h-3 mr-1" />
                  {{ getList(task.listId)?.name }}
                </Badge>

                <span
                  v-if="subtaskProgress(task.id).total > 0"
                  class="text-xs text-muted-foreground flex items-center gap-1"
                >
                  <ListChecks class="w-3 h-3" />
                  {{ subtaskProgress(task.id).done }}/{{ subtaskProgress(task.id).total }}
                </span>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                @click.stop="togglePin(task)"
              >
                <Pin v-if="!task.pinned" class="w-3.5 h-3.5" />
                <PinOff v-else class="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                @click.stop="openTaskDetail(task)"
              >
                <Edit2 class="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 text-destructive hover:text-destructive"
                @click.stop="deleteTarget = { type: 'task', id: task.id, name: task.title }"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </main>
  </div>

  <!-- 任务详情对话框 -->
  <Dialog v-model:open="showTaskDetail">
    <DialogContent class="max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>任务详情</DialogTitle>
        <DialogDescription>编辑任务信息、子任务和标签</DialogDescription>
      </DialogHeader>

      <div v-if="editingTask" class="space-y-4 py-2">
        <!-- 标题 -->
        <div class="space-y-2">
          <Label>任务标题</Label>
          <Input v-model="editForm.title" placeholder="任务标题" />
        </div>

        <!-- 描述 -->
        <div class="space-y-2">
          <Label>描述</Label>
          <textarea
            v-model="editForm.description"
            rows="3"
            placeholder="任务描述（可选）"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <!-- 优先级 -->
        <div class="space-y-2">
          <Label>优先级</Label>
          <div class="flex items-center gap-2">
            <button
              v-for="p in [0, 1, 2, 3]"
              :key="p"
              class="flex items-center gap-1 px-3 py-1.5 rounded-md border text-sm transition-colors"
              :class="editForm.priority === p ? 'bg-secondary border-primary' : 'hover:bg-accent'"
              @click="editForm.priority = p as TaskPriority"
            >
              <Flag
                class="w-3.5 h-3.5"
                :style="{ color: priorityColor(p as TaskPriority) }"
                :fill="priorityColor(p as TaskPriority)"
                v-if="p > 0"
              />
              <Flag v-else class="w-3.5 h-3.5 text-muted-foreground" />
              {{ priorityLabel(p as TaskPriority) }}
            </button>
          </div>
        </div>

        <!-- 清单 -->
        <div class="space-y-2">
          <Label>所属清单</Label>
          <select
            v-model="editForm.listId"
            class="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option :value="null">无清单</option>
            <option v-for="list in listStore.lists" :key="list.id" :value="list.id">
              {{ list.name }}
            </option>
          </select>
        </div>

        <!-- 日期 -->
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-2">
            <Label>到期日期</Label>
            <Input v-model="editForm.dueDate" type="date" />
          </div>
          <div class="space-y-2">
            <Label>提醒时间</Label>
            <Input v-model="editForm.remindAt" type="datetime-local" />
          </div>
        </div>

        <!-- 置顶 -->
        <div class="flex items-center justify-between">
          <Label class="flex items-center gap-2 cursor-pointer">
            <Pin class="w-4 h-4" /> 置顶
          </Label>
          <Switch v-model:checked="editForm.pinned" />
        </div>

        <!-- 标签 -->
        <div class="space-y-2">
          <Label>标签</Label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="tag in tagStore.tags"
              :key="tag.id"
              class="flex items-center gap-1 px-2 py-1 rounded-md border text-xs transition-colors"
              :class="editForm.tagIds.includes(tag.id) ? 'bg-secondary' : 'hover:bg-accent'"
              :style="{ borderColor: tag.color + '40' }"
              @click="toggleTagSelection(tag.id)"
            >
              <Hash class="w-3 h-3" :style="{ color: tag.color }" />
              {{ tag.name }}
            </button>
            <span v-if="tagStore.tags.length === 0" class="text-xs text-muted-foreground">
              暂无标签，请在左侧管理
            </span>
          </div>
        </div>

        <!-- 子任务 -->
        <div class="space-y-2">
          <Label>子任务</Label>
          <div class="flex items-center gap-2">
            <Input
              v-model="newSubtaskTitle"
              placeholder="添加子任务..."
              @keydown.enter="addSubtask"
            />
            <Button size="sm" @click="addSubtask">
              <Plus class="w-4 h-4" />
            </Button>
          </div>
          <div class="space-y-1">
            <div
              v-for="sub in subtaskStore.getSubtasks(editingTask.id)"
              :key="sub.id"
              class="flex items-center gap-2 p-2 rounded-md hover:bg-accent group"
            >
              <button @click="toggleSubtask(sub)">
                <CheckCircle2
                  v-if="sub.status === 'done'"
                  class="w-4 h-4 text-green-500"
                />
                <Circle v-else class="w-4 h-4 text-muted-foreground" />
              </button>
              <span
                class="text-sm flex-1"
                :class="{ 'line-through text-muted-foreground': sub.status === 'done' }"
              >{{ sub.title }}</span>
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                @click="deleteSubtask(sub)"
              >
                <Trash2 class="w-3 h-3" />
              </Button>
            </div>
            <p v-if="subtaskStore.getSubtasks(editingTask.id).length === 0" class="text-xs text-muted-foreground px-2">
              暂无子任务
            </p>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2">
        <Button
          variant="destructive"
          @click="deleteTarget = editingTask ? { type: 'task', id: editingTask.id, name: editingTask.title } : null"
        >
          <Trash2 class="w-4 h-4" />
          删除
        </Button>
        <Button variant="outline" @click="showTaskDetail = false">取消</Button>
        <Button @click="saveTaskDetail">保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- 清单与文件夹管理对话框 -->
  <Dialog v-model:open="showListManager">
    <DialogContent class="max-w-md max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>清单管理</DialogTitle>
        <DialogDescription>创建清单与文件夹来组织你的任务</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- 创建清单 -->
        <div class="space-y-2">
          <Label>新建清单</Label>
          <Input v-model="newListName" placeholder="清单名称" />
          <div class="flex items-center gap-2 flex-wrap">
            <button
              v-for="color in COLOR_PRESETS"
              :key="color"
              class="w-6 h-6 rounded-full border-2 transition-transform"
              :class="newListColor === color ? 'scale-110 border-foreground' : 'border-transparent'"
              :style="{ backgroundColor: color }"
              @click="newListColor = color"
            />
          </div>
          <select
            v-model="newListFolderId"
            class="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option :value="null">不归属任何文件夹</option>
            <option v-for="folder in folderStore.folders" :key="folder.id" :value="folder.id">
              {{ folder.name }}
            </option>
          </select>
          <Button size="sm" :disabled="!newListName.trim()" @click="createList">
            <Plus class="w-4 h-4" />
            创建清单
          </Button>
        </div>

        <div class="h-px bg-border" />

        <!-- 创建文件夹 -->
        <div class="space-y-2">
          <Label>新建文件夹</Label>
          <Input v-model="newFolderName" placeholder="文件夹名称" />
          <Button size="sm" :disabled="!newFolderName.trim()" @click="createFolder">
            <FolderPlus class="w-4 h-4" />
            创建文件夹
          </Button>
        </div>

        <div class="h-px bg-border" />

        <!-- 已有清单列表 -->
        <div class="space-y-1">
          <Label>已有清单</Label>
          <div
            v-for="list in listStore.lists"
            :key="list.id"
            class="flex items-center justify-between p-2 rounded-md hover:bg-accent group"
          >
            <div class="flex items-center gap-2 min-w-0">
              <ListTodo class="w-4 h-4 shrink-0" :style="{ color: list.color }" />
              <span class="text-sm truncate">{{ list.name }}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100"
              @click="deleteTarget = { type: 'list', id: list.id, name: list.name }"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </Button>
          </div>
          <p v-if="listStore.lists.length === 0" class="text-xs text-muted-foreground">暂无清单</p>
        </div>

        <!-- 已有文件夹 -->
        <div class="space-y-1">
          <Label>已有文件夹</Label>
          <div
            v-for="folder in folderStore.folders"
            :key="folder.id"
            class="flex items-center justify-between p-2 rounded-md hover:bg-accent group"
          >
            <div class="flex items-center gap-2 min-w-0">
              <Folder class="w-4 h-4 shrink-0 text-muted-foreground" />
              <span class="text-sm truncate">{{ folder.name }}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100"
              @click="deleteTarget = { type: 'folder', id: folder.id, name: folder.name }"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </Button>
          </div>
          <p v-if="folderStore.folders.length === 0" class="text-xs text-muted-foreground">暂无文件夹</p>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <!-- 标签管理对话框 -->
  <Dialog v-model:open="showTagManager">
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>标签管理</DialogTitle>
        <DialogDescription>创建标签来分类任务</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <div class="space-y-2">
          <Input v-model="newTagName" placeholder="标签名称" />
          <div class="flex items-center gap-2 flex-wrap">
            <button
              v-for="color in COLOR_PRESETS"
              :key="color"
              class="w-6 h-6 rounded-full border-2 transition-transform"
              :class="newTagColor === color ? 'scale-110 border-foreground' : 'border-transparent'"
              :style="{ backgroundColor: color }"
              @click="newTagColor = color"
            />
          </div>
          <Button size="sm" :disabled="!newTagName.trim()" @click="createTag">
            <Plus class="w-4 h-4" />
            创建标签
          </Button>
        </div>

        <div class="h-px bg-border" />

        <div class="space-y-1">
          <Label>已有标签</Label>
          <div
            v-for="tag in tagStore.tags"
            :key="tag.id"
            class="flex items-center justify-between p-2 rounded-md hover:bg-accent group"
          >
            <div class="flex items-center gap-2">
              <Hash class="w-4 h-4" :style="{ color: tag.color }" />
              <span class="text-sm">{{ tag.name }}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100"
              @click="deleteTarget = { type: 'tag', id: tag.id, name: tag.name }"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </Button>
          </div>
          <p v-if="tagStore.tags.length === 0" class="text-xs text-muted-foreground">暂无标签</p>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <!-- 删除确认 -->
  <Dialog :open="!!deleteTarget" @update:open="(v) => { if (!v) deleteTarget = null }">
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>确认删除</DialogTitle>
        <DialogDescription>
          确定要删除「{{ deleteTarget?.name }}」吗？此操作不可撤销。
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="gap-2">
        <Button variant="outline" @click="deleteTarget = null">取消</Button>
        <Button variant="destructive" @click="confirmDelete">删除</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
