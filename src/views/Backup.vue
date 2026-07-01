<script setup lang="ts">
import { ref } from 'vue'
import { api } from '@/api/client'
import type { FullBackupData, FullImportResult } from '@/api/client'
import {
  useSubscriptionStore,
  useGroupStore,
  useChannelStore,
  useTaskFolderStore,
  useTaskListStore,
  useTaskStore,
  useTagStore
} from '@/stores'
import { Download, Upload, RefreshCw, Check, AlertCircle, Database, FileJson } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'

const subscriptionStore = useSubscriptionStore()
const groupStore = useGroupStore()
const channelStore = useChannelStore()
const taskFolderStore = useTaskFolderStore()
const taskListStore = useTaskListStore()
const taskStore = useTaskStore()
const tagStore = useTagStore()

// 导出相关状态
const exporting = ref(false)
const exportError = ref('')

// 恢复相关状态
const importing = ref(false)
const importError = ref('')
const importResult = ref<FullImportResult | null>(null)
const showImportConfirm = ref(false)
const pendingBackup = ref<FullBackupData | null>(null)
const importMode = ref<'replace' | 'merge'>('replace')
const fileInput = ref<HTMLInputElement | null>(null)

// 定时器引用，便于清除
let exportErrorTimer: ReturnType<typeof setTimeout> | null = null
let importErrorTimer: ReturnType<typeof setTimeout> | null = null
let importResultTimer: ReturnType<typeof setTimeout> | null = null

/** 设置导出错误并 5 秒后自动清除 */
function setExportError(msg: string) {
  if (exportErrorTimer) clearTimeout(exportErrorTimer)
  exportError.value = msg
  if (msg) {
    exportErrorTimer = setTimeout(() => {
      exportError.value = ''
    }, 5000)
  }
}

/** 设置恢复错误并 5 秒后自动清除 */
function setImportError(msg: string) {
  if (importErrorTimer) clearTimeout(importErrorTimer)
  importError.value = msg
  if (msg) {
    importErrorTimer = setTimeout(() => {
      importError.value = ''
    }, 5000)
  }
}

/** 设置导入结果并 8 秒后自动清除 */
function setImportResult(result: FullImportResult | null) {
  if (importResultTimer) clearTimeout(importResultTimer)
  importResult.value = result
  if (result) {
    importResultTimer = setTimeout(() => {
      importResult.value = null
    }, 8000)
  }
}

/** 获取今日日期字符串 YYYY-MM-DD */
function getTodayStr(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 导出全量备份：调用接口后用 Blob 下载 JSON 文件 */
async function handleExport() {
  if (exporting.value) return
  exporting.value = true
  setExportError('')
  try {
    const res = await api.exportFullBackup()
    if (res.success && res.data) {
      const json = JSON.stringify(res.data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `sub-tracker-full-backup-${getTodayStr()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } else {
      setExportError(res.error || '导出失败，请稍后重试')
    }
  } catch (err) {
    setExportError(String(err) || '导出失败，请稍后重试')
  } finally {
    exporting.value = false
  }
}

/** 触发隐藏的文件选择 input */
function triggerFileInput() {
  fileInput.value?.click()
}

/** 处理文件选择：解析、校验、弹出确认对话框 */
async function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 重置 value 以便重复选择同一文件
  input.value = ''
  if (!file) return

  setImportError('')
  try {
    const text = await file.text()
    const data = JSON.parse(text) as FullBackupData

    // 校验：必须是对象且至少包含一个数据数组
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      setImportError('备份文件格式无效：必须是 JSON 对象')
      return
    }

    const dataKeys: (keyof FullBackupData)[] = [
      'subscriptions', 'groups', 'channels',
      'taskFolders', 'taskLists', 'tasks', 'subtasks', 'tags', 'taskTags'
    ]
    const hasDataArray = dataKeys.some(k => Array.isArray(data[k]))
    if (!hasDataArray) {
      setImportError('备份文件格式无效：未找到任何数据数组')
      return
    }

    pendingBackup.value = data
    importMode.value = 'replace'
    showImportConfirm.value = true
  } catch (err) {
    setImportError('无法解析备份文件：' + String(err))
  }
}

/** 计算备份内容统计行 */
function getBackupStats(backup: FullBackupData | null) {
  if (!backup) return []
  return [
    { label: '订阅', count: backup.subscriptions?.length ?? 0, unit: '条' },
    { label: '分组', count: backup.groups?.length ?? 0, unit: '个' },
    { label: '通知渠道', count: backup.channels?.length ?? 0, unit: '个' },
    { label: '任务文件夹', count: backup.taskFolders?.length ?? 0, unit: '个' },
    { label: '清单', count: backup.taskLists?.length ?? 0, unit: '个' },
    { label: '任务', count: backup.tasks?.length ?? 0, unit: '条' },
    { label: '子任务', count: backup.subtasks?.length ?? 0, unit: '条' },
    { label: '标签', count: backup.tags?.length ?? 0, unit: '个' }
  ]
}

/** 确认恢复：调用接口后刷新所有 store 并显示导入结果 */
async function handleImport() {
  if (!pendingBackup.value || importing.value) return
  importing.value = true
  setImportError('')
  try {
    const res = await api.importFullBackup(pendingBackup.value, importMode.value)
    if (res.success && res.data) {
      setImportResult(res.data)
      showImportConfirm.value = false
      pendingBackup.value = null
      // 刷新所有 store 的本地数据
      await Promise.all([
        subscriptionStore.fetchSubscriptions(),
        subscriptionStore.fetchStats(),
        groupStore.fetchGroups(),
        channelStore.fetchChannels(),
        taskFolderStore.fetchFolders(),
        taskListStore.fetchLists(),
        taskStore.fetchTasks(),
        tagStore.fetchTags()
      ])
    } else {
      setImportError(res.error || '恢复失败，请稍后重试')
    }
  } catch (err) {
    setImportError(String(err) || '恢复失败，请稍后重试')
  } finally {
    importing.value = false
  }
}

/** 导入结果各分类统计行 */
function getResultItems(result: FullImportResult) {
  return [
    { label: '订阅', count: result.subscriptions },
    { label: '分组', count: result.groups },
    { label: '通知渠道', count: result.channels },
    { label: '任务文件夹', count: result.taskFolders },
    { label: '清单', count: result.taskLists },
    { label: '任务', count: result.tasks },
    { label: '子任务', count: result.subtasks },
    { label: '标签', count: result.tags },
    { label: '任务标签关联', count: result.taskTags }
  ]
}
</script>

<template>
  <div class="animate-fade-in max-w-3xl mx-auto">
    <!-- 页面标题 -->
    <div class="mb-6">
      <div class="flex items-center gap-2">
        <Database class="w-6 h-6 text-primary" />
        <h1 class="text-xl md:text-2xl font-bold">备份与恢复</h1>
      </div>
      <p class="text-sm text-muted-foreground mt-1">导出/恢复你的全部数据（订阅 + 任务管理）</p>
    </div>

    <!-- 导入结果提示（绿色成功框） -->
    <div
      v-if="importResult"
      class="mb-4 p-4 rounded-lg bg-success/10 text-success border border-success/20"
    >
      <div class="flex items-center gap-2 font-medium mb-2">
        <Check class="w-4 h-4 shrink-0" />
        <span>恢复成功</span>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-sm">
        <div v-for="item in getResultItems(importResult)" :key="item.label">
          <span class="text-muted-foreground">{{ item.label }}：</span>
          <span class="font-medium">{{ item.count }}</span>
        </div>
      </div>
    </div>

    <!-- 导出区域 -->
    <Card class="mb-6">
      <CardHeader>
        <div class="flex items-center gap-2">
          <FileJson class="w-5 h-5 text-primary" />
          <CardTitle>导出备份</CardTitle>
        </div>
        <CardDescription>
          将你的全部数据（订阅、分组、通知渠道、任务文件夹、清单、任务、子任务、标签）导出为 JSON 文件
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          v-if="exportError"
          class="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2"
        >
          <AlertCircle class="w-4 h-4 shrink-0" />
          <span>{{ exportError }}</span>
        </div>
      </CardContent>
      <CardFooter>
        <Button :disabled="exporting" @click="handleExport">
          <Download v-if="!exporting" class="w-4 h-4" />
          <RefreshCw v-else class="w-4 h-4 animate-spin" />
          {{ exporting ? '导出中...' : '导出备份' }}
        </Button>
      </CardFooter>
    </Card>

    <!-- 恢复区域 -->
    <Card>
      <CardHeader>
        <div class="flex items-center gap-2">
          <Upload class="w-5 h-5 text-primary" />
          <CardTitle>恢复备份</CardTitle>
        </div>
        <CardDescription>
          从备份文件恢复数据。注意：覆盖模式会清空当前全部数据后导入
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          v-if="importError"
          class="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2"
        >
          <AlertCircle class="w-4 h-4 shrink-0" />
          <span>{{ importError }}</span>
        </div>
        <p class="text-sm text-muted-foreground">
          点击下方按钮选择之前导出的备份文件，确认后将开始恢复数据。
        </p>
      </CardContent>
      <CardFooter>
        <Button variant="outline" :disabled="importing" @click="triggerFileInput">
          <Upload class="w-4 h-4" />
          选择备份文件
        </Button>
      </CardFooter>
    </Card>

    <!-- 隐藏的文件选择 input -->
    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      class="hidden"
      @change="handleFileSelect"
    />

    <!-- 恢复确认对话框 -->
    <Dialog :open="showImportConfirm" @update:open="(v) => { showImportConfirm = v }">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>确认恢复备份</DialogTitle>
          <DialogDescription>
            请选择恢复模式并核对备份内容统计，确认后将开始恢复。
          </DialogDescription>
        </DialogHeader>

        <!-- 恢复模式单选 -->
        <div class="space-y-2">
          <label
            class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
            :class="importMode === 'replace'
              ? 'border-primary bg-primary/5'
              : 'border-input hover:bg-accent'"
          >
            <input
              type="radio"
              v-model="importMode"
              value="replace"
              class="mt-1 accent-primary"
            />
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <span class="font-medium text-foreground">覆盖恢复</span>
                <span class="px-1.5 py-0.5 text-xs rounded bg-primary/15 text-primary">推荐</span>
              </div>
              <p class="text-sm text-muted-foreground mt-0.5">清空当前全部数据后导入备份内容</p>
            </div>
          </label>

          <label
            class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
            :class="importMode === 'merge'
              ? 'border-primary bg-primary/5'
              : 'border-input hover:bg-accent'"
          >
            <input
              type="radio"
              v-model="importMode"
              value="merge"
              class="mt-1 accent-primary"
            />
            <div class="flex-1">
              <span class="font-medium text-foreground">追加合并</span>
              <p class="text-sm text-muted-foreground mt-0.5">保留当前数据，将备份内容追加导入</p>
            </div>
          </label>
        </div>

        <!-- 备份内容统计 -->
        <div class="rounded-lg border bg-muted/40 p-3">
          <p class="text-sm font-medium text-foreground mb-2">备份内容统计</p>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div v-for="stat in getBackupStats(pendingBackup)" :key="stat.label">
              <span class="text-muted-foreground">{{ stat.label }}：</span>
              <span class="font-medium text-foreground">{{ stat.count }} {{ stat.unit }}</span>
            </div>
          </div>
        </div>

        <!-- 对话框内错误提示 -->
        <div
          v-if="importError"
          class="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2"
        >
          <AlertCircle class="w-4 h-4 shrink-0" />
          <span>{{ importError }}</span>
        </div>

        <DialogFooter class="gap-2">
          <Button
            variant="outline"
            :disabled="importing"
            @click="showImportConfirm = false"
          >
            取消
          </Button>
          <Button :disabled="importing" @click="handleImport">
            <RefreshCw v-if="importing" class="w-4 h-4 animate-spin" />
            {{ importing ? '恢复中...' : '确认恢复' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
