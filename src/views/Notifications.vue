<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '@/api/client'
import { CheckCircle, XCircle, RefreshCw, Inbox } from 'lucide-vue-next'
import type { NotificationLog } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'

const logs = ref<NotificationLog[]>([])
const loading = ref(false)

onMounted(() => {
  fetchLogs()
})

async function fetchLogs() {
  loading.value = true
  try {
    const res = await api.getNotificationLogs(50)
    if (res.success && res.data) {
      logs.value = res.data
    }
  } finally {
    loading.value = false
  }
}

function formatDate(date: string): string {
  return new Date(date).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getChannelIcon(type: string): string {
  switch (type) {
    case 'email': return '📧'
    case 'telegram': return '📨'
    case 'feishu': return '💬'
    case 'wechat': return '💼'
    case 'notifyx': return '🔔'
    default: return '📢'
  }
}
</script>

<template>
  <div class="animate-fade-in">
    <div class="flex items-center justify-between mb-4 md:mb-8">
      <h1 class="text-xl md:text-2xl font-bold">通知日志</h1>
      <Button variant="outline" @click="fetchLogs">
        <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />
        刷新
      </Button>
    </div>

    <Card>
      <CardContent class="p-0">
        <div v-if="loading" class="divide-y divide-border">
          <div
            v-for="i in 5"
            :key="i"
            class="flex items-center gap-4 p-4"
          >
            <Skeleton class="w-10 h-10 rounded-md shrink-0" />
            <div class="flex-1 space-y-2">
              <Skeleton class="h-4 w-1/3" />
              <Skeleton class="h-3 w-1/2" />
            </div>
            <Skeleton class="h-4 w-24 shrink-0" />
          </div>
        </div>

        <EmptyState
          v-else-if="logs.length === 0"
          :icon="Inbox"
          title="暂无通知日志"
          description="当订阅到期通知发送后，日志将显示在这里"
          class="m-6"
        />

        <div v-else class="divide-y divide-border">
          <div
            v-for="log in logs"
            :key="log.id"
            class="flex items-center gap-3 md:gap-4 p-3 md:p-4 hover:bg-accent transition-colors"
          >
            <div
              class="w-10 h-10 rounded-md flex items-center justify-center shrink-0"
              :class="log.success ? 'bg-success/10' : 'bg-destructive/10'"
            >
              <CheckCircle v-if="log.success" class="w-5 h-5 text-success" />
              <XCircle v-else class="w-5 h-5 text-destructive" />
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-medium">{{ log.subscriptionName }}</span>
                <span class="text-muted-foreground">{{ getChannelIcon(log.channelType) }} {{ log.channelType }}</span>
              </div>
              <p class="text-sm text-muted-foreground truncate">
                {{ log.errorMessage || (log.success ? '发送成功' : '发送失败') }}
              </p>
            </div>

            <div class="text-sm text-muted-foreground shrink-0">
              {{ formatDate(log.sentAt) }}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
