<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSubscriptionStore, useGroupStore } from '@/stores'
import { api } from '@/api/client'
import { Plus, Search, Filter, Edit2, Trash2, Calendar, Send, RefreshCw, Check, X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { getDaysUntilExpire, getExpireStatus, formatExpireDate, expireLabel, isRecurring } from '@/lib/date'

const router = useRouter()
const subscriptionStore = useSubscriptionStore()
const groupStore = useGroupStore()

const searchQuery = ref('')
const selectedGroupId = ref<string | null>(null)
const showDeleteConfirm = ref(false)
const deletingId = ref<string | null>(null)

// 测试推送状态
const testingId = ref<string | null>(null)
const testResult = ref<{ id: string; success: number; failed: number; total: number; error?: string } | null>(null)

// 一键续期状态
const extendingId = ref<string | null>(null)
const extendResult = ref<{ id: string; success: boolean; error?: string } | null>(null)

onMounted(async () => {
  await Promise.all([
    subscriptionStore.fetchSubscriptions(),
    groupStore.fetchGroups()
  ])
})

const filteredSubscriptions = computed(() => {
  let result = subscriptionStore.subscriptions

  if (selectedGroupId.value) {
    result = result.filter(s => s.groupId === selectedGroupId.value)
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.description?.toLowerCase().includes(query)
    )
  }

  // 按距到期天数升序排序（周期模式自动滚动到下次到期）
  return result.sort((a, b) => getDaysUntilExpire(a.expireDate) - getDaysUntilExpire(b.expireDate))
})

function getGroupColor(groupId?: string): string {
  if (!groupId) return '#6366F1'
  return groupStore.groups.find(g => g.id === groupId)?.color || '#6366F1'
}

async function confirmDelete(id: string) {
  deletingId.value = id
  showDeleteConfirm.value = true
}

async function handleDelete() {
  if (deletingId.value) {
    await subscriptionStore.deleteSubscription(deletingId.value)
    showDeleteConfirm.value = false
    deletingId.value = null
  }
}

/**
 * 测试推送：使用订阅真实数据向所有启用的通知渠道发送测试通知
 */
async function testPush(id: string) {
  testingId.value = id
  testResult.value = null
  try {
    const res = await api.testSubscription(id)
    if (res.success && res.data) {
      testResult.value = {
        id,
        success: res.data.success,
        failed: res.data.failed,
        total: res.data.total
      }
    } else {
      testResult.value = {
        id,
        success: 0,
        failed: 0,
        total: 0,
        error: res.error || '测试失败'
      }
    }
  } finally {
    testingId.value = null
    // 5 秒后自动清除提示
    setTimeout(() => {
      if (testResult.value?.id === id) testResult.value = null
    }, 5000)
  }
}

/**
 * 一键续期：按订阅的 extendMode 与 renewalPeriod 推后到期日期
 */
async function extendSubscription(id: string) {
  extendingId.value = id
  extendResult.value = null
  try {
    const res = await api.extendSubscription(id)
    if (res.success) {
      extendResult.value = { id, success: true }
      // 刷新列表数据
      await subscriptionStore.fetchSubscriptions()
    } else {
      extendResult.value = { id, success: false, error: res.error || '续期失败' }
    }
  } finally {
    extendingId.value = null
    setTimeout(() => {
      if (extendResult.value?.id === id) extendResult.value = null
    }, 5000)
  }
}
</script>

<template>
  <div class="animate-fade-in">
    <div class="flex items-center justify-between mb-4 md:mb-8">
      <h1 class="text-xl md:text-2xl font-bold">订阅管理</h1>
      <div class="flex items-center gap-2">
        <Button @click="router.push({ name: 'subscription-new' })">
          <Plus class="w-4 h-4" />
          添加订阅
        </Button>
      </div>
    </div>

    <Card class="p-3 md:p-4 mb-4 md:mb-6">
      <div class="flex flex-col md:flex-row md:flex-wrap md:items-center gap-3 md:gap-4">
        <div class="relative flex-1 min-w-0">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
          <Input
            v-model="searchQuery"
            type="text"
            placeholder="搜索订阅..."
            class="pl-9"
          />
        </div>

        <div class="flex items-center gap-2">
          <Filter class="w-4 h-4 text-muted-foreground shrink-0" />
          <select
            v-model="selectedGroupId"
            class="flex h-10 w-full md:w-auto md:min-w-[150px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option :value="null">全部分组</option>
            <option v-for="group in groupStore.groups" :key="group.id" :value="group.id">
              {{ group.name }}
            </option>
          </select>
        </div>
      </div>
    </Card>

    <EmptyState
      v-if="filteredSubscriptions.length === 0"
      class="mb-6"
      :icon="Search"
      title="暂无订阅"
      description="还没有添加任何订阅，点击下方按钮创建第一个订阅。"
    >
      <Button @click="router.push({ name: 'subscription-new' })">
        <Plus class="w-4 h-4" />
        添加第一个订阅
      </Button>
    </EmptyState>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
      <Card
        v-for="sub in filteredSubscriptions"
        :key="sub.id"
        class="hover:border-primary/30 transition-all cursor-pointer group"
        @click="router.push({ name: 'subscription-edit', params: { id: sub.id } })"
      >
        <CardHeader class="pb-3">
          <div class="flex items-start justify-between">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold"
              :style="{ backgroundColor: getGroupColor(sub.groupId) + '20', color: getGroupColor(sub.groupId) }"
            >
              {{ sub.icon || sub.name.charAt(0) }}
            </div>
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                @click.stop="router.push({ name: 'subscription-edit', params: { id: sub.id } })"
              >
                <Edit2 class="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-destructive hover:text-destructive"
                @click.stop="confirmDelete(sub.id)"
              >
                <Trash2 class="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div class="mt-3">
            <h3 class="font-semibold text-lg">{{ sub.name }}</h3>
            <p v-if="sub.description" class="text-sm text-muted-foreground truncate">{{ sub.description }}</p>
          </div>
        </CardHeader>

        <CardContent v-if="sub.amount" class="pt-0 pb-3">
          <span class="font-mono text-lg font-semibold text-primary">
            ¥{{ sub.amount.toFixed(2) }}
          </span>
          <span class="text-sm text-muted-foreground">/{{ sub.renewalPeriod === 'yearly' ? '年' : '月' }}</span>
        </CardContent>

        <CardFooter class="flex items-center justify-between pt-3 border-t">
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar class="w-4 h-4" />
            {{ formatExpireDate(sub.expireDate) }}
          </div>
          <Badge
            :variant="getExpireStatus(sub.expireDate) === 'expired' || getExpireStatus(sub.expireDate) === 'critical'
              ? 'destructive'
              : getExpireStatus(sub.expireDate) === 'warning'
                ? 'warning'
                : 'success'"
          >
            {{ expireLabel(sub.expireDate) }}
          </Badge>
        </CardFooter>

        <!-- 卡片操作区：测试推送 + 一键续期（仅周期模式） -->
        <div class="px-3 md:px-6 pb-3 pt-2 space-y-2">
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              class="flex-1 h-8"
              :disabled="testingId === sub.id"
              @click.stop="testPush(sub.id)"
            >
              <Send v-if="testingId !== sub.id" class="w-3.5 h-3.5" />
              <RefreshCw v-else class="w-3.5 h-3.5 animate-spin" />
              {{ testingId === sub.id ? '推送中...' : '测试推送' }}
            </Button>
            <Button
              v-if="isRecurring(sub.expireDate)"
              variant="outline"
              size="sm"
              class="flex-1 h-8"
              :disabled="extendingId === sub.id"
              @click.stop="extendSubscription(sub.id)"
            >
              <RefreshCw v-if="extendingId === sub.id" class="w-3.5 h-3.5 animate-spin" />
              <Calendar v-else class="w-3.5 h-3.5" />
              {{ extendingId === sub.id ? '续期中...' : '一键续期' }}
            </Button>
          </div>

          <!-- 测试推送结果 -->
          <div
            v-if="testResult?.id === sub.id"
            class="p-2 rounded-md text-xs flex items-center gap-2"
            :class="testResult.error || testResult.failed > 0
              ? 'bg-destructive/10 text-destructive'
              : 'bg-success/10 text-success'"
          >
            <X v-if="testResult.error || (testResult.total > 0 && testResult.success === 0)" class="w-3.5 h-3.5 shrink-0" />
            <Check v-else class="w-3.5 h-3.5 shrink-0" />
            <span class="truncate">
              <template v-if="testResult.error">{{ testResult.error }}</template>
              <template v-else>
                成功 {{ testResult.success }}/{{ testResult.total }}<template v-if="testResult.failed > 0">，失败 {{ testResult.failed }}</template>
              </template>
            </span>
          </div>

          <!-- 一键续期结果 -->
          <div
            v-if="extendResult?.id === sub.id"
            class="p-2 rounded-md text-xs flex items-center gap-2"
            :class="extendResult.success ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'"
          >
            <Check v-if="extendResult.success" class="w-3.5 h-3.5 shrink-0" />
            <X v-else class="w-3.5 h-3.5 shrink-0" />
            <span class="truncate">
              {{ extendResult.success ? '续期成功，到期日已推后一个周期' : (extendResult.error || '续期失败') }}
            </span>
          </div>
        </div>
      </Card>
    </div>

    <Dialog v-model:open="showDeleteConfirm">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
          <DialogDescription>确定要删除这个订阅吗？此操作不可撤销。</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showDeleteConfirm = false">取消</Button>
          <Button variant="destructive" @click="handleDelete">删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
