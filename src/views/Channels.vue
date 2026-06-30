<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useChannelStore } from '@/stores'
import { Plus, Edit2, Trash2, Mail, Send, Check, X, Bell } from 'lucide-vue-next'
import type { NotificationChannel, ChannelType } from '@/api/client'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'

const channelStore = useChannelStore()

const showForm = ref(false)
const showDeleteConfirm = ref(false)
const editingChannel = ref<NotificationChannel | null>(null)
const deletingId = ref<string | null>(null)
const testingId = ref<string | null>(null)
const testResult = ref<{ id: string; success: boolean; error?: string } | null>(null)
const submitting = ref(false)
const loadingConfig = ref(false)

const form = ref({
  type: 'email' as ChannelType,
  name: '',
  config: {} as Record<string, string>,
  enabled: true
})

const channelTypes: { value: ChannelType; label: string; icon: typeof Mail; fields: { key: string; label: string; placeholder: string }[] }[] = [
  {
    value: 'email',
    label: '邮件',
    icon: Mail,
    fields: [
      { key: 'smtpServer', label: 'SMTP 服务器', placeholder: 'smtp.gmail.com' },
      { key: 'smtpPort', label: '端口', placeholder: '587' },
      { key: 'email', label: '邮箱地址', placeholder: 'your@email.com' },
      { key: 'password', label: '密码/授权码', placeholder: '••••••••' },
      { key: 'toEmail', label: '收件人邮箱', placeholder: 'notify@email.com' }
    ]
  },
  {
    value: 'telegram',
    label: 'Telegram',
    icon: Send,
    fields: [
      { key: 'botToken', label: 'Bot Token', placeholder: '123456:ABC-DEF...' },
      { key: 'chatId', label: 'Chat ID', placeholder: '-1001234567890' }
    ]
  },
  {
    value: 'feishu',
    label: '飞书',
    icon: Send,
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx' }
    ]
  },
  {
    value: 'wechat',
    label: '企业微信',
    icon: Send,
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx' }
    ]
  },
  {
    value: 'notifyx',
    label: 'NotifyX',
    icon: Send,
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'your-api-key' }
    ]
  }
]

onMounted(() => {
  channelStore.fetchChannels()
})

function getChannelTypeConfig(type: ChannelType) {
  return channelTypes.find(t => t.value === type)
}

function openCreateForm() {
  editingChannel.value = null
  form.value = {
    type: 'email',
    name: '',
    config: {},
    enabled: true
  }
  showForm.value = true
}

async function openEditForm(channel: NotificationChannel) {
  editingChannel.value = channel
  form.value = {
    type: channel.type,
    name: channel.name,
    config: {},
    enabled: channel.enabled
  }
  showForm.value = true
  loadingConfig.value = true

  // 列表接口不返回 config，需调用详情接口获取解密后的完整配置
  try {
    const res = await api.getChannel(channel.id)
    if (res.success && res.data?.config) {
      form.value.config = { ...res.data.config }
    }
  } catch {
    // 获取失败时保留空配置，用户可重新填写
  } finally {
    loadingConfig.value = false
  }
}

async function handleSubmit() {
  if (!form.value.name.trim() || submitting.value) return

  submitting.value = true
  try {
    const data = {
      type: form.value.type,
      name: form.value.name,
      config: form.value.config,
      enabled: form.value.enabled
    }

    if (editingChannel.value?.id) {
      await channelStore.updateChannel(editingChannel.value.id, data)
    } else {
      await channelStore.createChannel(data)
    }

    showForm.value = false
    editingChannel.value = null
  } finally {
    submitting.value = false
  }
}

function confirmDelete(id: string) {
  deletingId.value = id
  showDeleteConfirm.value = true
}

async function handleDelete() {
  if (deletingId.value) {
    await channelStore.deleteChannel(deletingId.value)
    showDeleteConfirm.value = false
    deletingId.value = null
  }
}

async function toggleEnabled(channel: NotificationChannel) {
  await channelStore.updateChannel(channel.id, { enabled: !channel.enabled })
}

async function testChannel(channel: NotificationChannel) {
  testingId.value = channel.id
  testResult.value = null

  const result = await channelStore.testChannel(channel.id)
  testResult.value = { id: channel.id, success: result.success || false, error: result.error }

  testingId.value = null

  setTimeout(() => {
    testResult.value = null
  }, 5000)
}
</script>

<template>
  <div class="animate-fade-in">
    <div class="flex items-center justify-between mb-4 md:mb-8">
      <h1 class="text-xl md:text-2xl font-bold">通知渠道</h1>
      <Button @click="openCreateForm">
        <Plus class="w-4 h-4" />
        添加渠道
      </Button>
    </div>

    <EmptyState
      v-if="channelStore.channels.length === 0"
      :icon="Bell"
      title="暂无通知渠道"
      description="还没有添加任何通知渠道，点击下方按钮配置第一个渠道。"
    >
      <Button @click="openCreateForm">
        <Plus class="w-4 h-4" />
        添加第一个渠道
      </Button>
    </EmptyState>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
      <Card
        v-for="channel in channelStore.channels"
        :key="channel.id"
      >
        <CardHeader class="pb-3">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 rounded-lg flex items-center justify-center"
                :class="channel.enabled ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'"
              >
                <component :is="getChannelTypeConfig(channel.type)?.icon || Send" class="w-5 h-5" />
              </div>
              <div>
                <p class="font-medium text-foreground">{{ channel.name }}</p>
                <p class="text-sm text-muted-foreground">{{ getChannelTypeConfig(channel.type)?.label }}</p>
              </div>
            </div>

            <Switch
              :checked="channel.enabled"
              @update:checked="toggleEnabled(channel)"
            />
          </div>
        </CardHeader>

        <CardContent class="pt-0 pb-3">
          <div class="text-sm text-muted-foreground mb-2">
            <template v-if="channel.type === 'email'">
              {{ (channel.config as Record<string, string>).email || '未配置' }}
            </template>
            <template v-else-if="channel.type === 'telegram'">
              Bot: {{ (channel.config as Record<string, string>).botToken ? '已配置' : '未配置' }}
            </template>
            <template v-else-if="channel.type === 'feishu' || channel.type === 'wechat'">
              Webhook: {{ (channel.config as Record<string, string>).webhookUrl ? '已配置' : '未配置' }}
            </template>
            <template v-else-if="channel.type === 'notifyx'">
              API Key: {{ (channel.config as Record<string, string>).apiKey ? '已配置' : '未配置' }}
            </template>
          </div>

          <Badge
            :variant="channel.enabled ? 'success' : 'secondary'"
          >
            {{ channel.enabled ? '已启用' : '已禁用' }}
          </Badge>

          <div
            v-if="testResult?.id === channel.id"
            class="mt-3 p-3 rounded-lg text-sm flex items-center gap-2"
            :class="testResult.success
              ? 'bg-success/20 text-success'
              : 'bg-destructive/20 text-destructive'"
          >
            <Check v-if="testResult.success" class="w-4 h-4 shrink-0" />
            <X v-else class="w-4 h-4 shrink-0" />
            <span class="truncate">{{ testResult.success ? '测试成功' : testResult.error || '测试失败' }}</span>
          </div>
        </CardContent>

        <CardFooter class="gap-2 pt-3 border-t">
          <Button
            variant="outline"
            size="sm"
            class="flex-1"
            :disabled="testingId === channel.id"
            @click="testChannel(channel)"
          >
            {{ testingId === channel.id ? '测试中...' : '测试' }}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            @click="openEditForm(channel)"
          >
            <Edit2 class="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8 text-destructive hover:text-destructive"
            @click="confirmDelete(channel.id)"
          >
            <Trash2 class="w-4 h-4" />
          </Button>
        </CardFooter>
      </Card>
    </div>

    <Dialog v-model:open="showForm">
      <DialogContent class="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{ editingChannel?.id ? '编辑渠道' : '添加渠道' }}</DialogTitle>
          <DialogDescription>
            {{ editingChannel?.id ? '修改通知渠道的配置信息。' : '配置一个新的通知渠道，用于接收订阅提醒。' }}
          </DialogDescription>
        </DialogHeader>

        <form @submit.prevent="handleSubmit" class="space-y-5">
          <div class="space-y-2">
            <Label for="channel-type">渠道类型</Label>
            <select
              id="channel-type"
              v-model="form.type"
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!!editingChannel?.id"
            >
              <option v-for="type in channelTypes" :key="type.value" :value="type.value">
                {{ type.label }}
              </option>
            </select>
          </div>

          <div class="space-y-2">
            <Label for="channel-name">渠道名称</Label>
            <Input
              id="channel-name"
              v-model="form.name"
              type="text"
              placeholder="例如：我的 Telegram"
              required
            />
          </div>

          <div class="space-y-4">
            <div v-for="field in getChannelTypeConfig(form.type)?.fields" :key="field.key" class="space-y-2">
              <Label :for="`channel-${field.key}`">{{ field.label }}</Label>
              <Input
                :id="`channel-${field.key}`"
                v-model="form.config[field.key]"
                type="text"
                :placeholder="loadingConfig ? '加载中...' : field.placeholder"
                :disabled="loadingConfig"
              />
            </div>
          </div>
        </form>

        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showForm = false" :disabled="submitting">取消</Button>
          <Button @click="handleSubmit" :disabled="submitting || loadingConfig">
            {{ submitting ? '保存中...' : '保存' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="showDeleteConfirm">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
          <DialogDescription>
            确定要删除这个通知渠道吗？此操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showDeleteConfirm = false">取消</Button>
          <Button variant="destructive" @click="handleDelete">删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
