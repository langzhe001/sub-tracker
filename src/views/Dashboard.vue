<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSubscriptionStore, useGroupStore } from '@/stores'
import {
  CreditCard,
  AlertTriangle,
  Clock,
  CheckCircle,
  FolderTree,
  Bell,
  Plus,
  Calendar
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { getDaysUntilExpire, getExpireStatus, formatExpireDate, expireLabel } from '@/lib/date'

const router = useRouter()
const subscriptionStore = useSubscriptionStore()
const groupStore = useGroupStore()

onMounted(async () => {
  await Promise.all([
    subscriptionStore.fetchStats(),
    subscriptionStore.fetchSubscriptions(),
    groupStore.fetchGroups()
  ])
})

const stats = computed(() => subscriptionStore.stats)

const expiringSubs = computed(() =>
  subscriptionStore.subscriptions
    .filter(s => getExpireStatus(s.expireDate) !== 'normal')
    .sort((a, b) => getDaysUntilExpire(a.expireDate) - getDaysUntilExpire(b.expireDate))
    .slice(0, 5)
)

function getGroupColor(groupId?: string): string {
  return groupStore.groups.find(g => g.id === groupId)?.color || 'hsl(var(--primary))'
}
</script>

<template>
  <div class="animate-fade-in">
    <div class="flex items-center justify-between mb-4 md:mb-8">
      <h1 class="text-xl md:text-2xl font-bold">仪表盘</h1>
      <Button @click="router.push({ name: 'subscription-new' })">
        <Plus class="w-4 h-4" />
        添加订阅
      </Button>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-4 md:mb-8">
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">总订阅数</CardTitle>
          <CreditCard class="w-5 h-5 text-primary" />
        </CardHeader>
        <CardContent>
          <span class="text-2xl md:text-3xl font-bold font-mono">{{ stats?.totalSubscriptions || 0 }}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">7天内到期</CardTitle>
          <Clock class="w-5 h-5 text-warning" />
        </CardHeader>
        <CardContent>
          <span class="text-2xl md:text-3xl font-bold font-mono text-warning">{{ stats?.expiringWithin7Days || 0 }}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">本月到期</CardTitle>
          <Calendar class="w-5 h-5 text-secondary-foreground" />
        </CardHeader>
        <CardContent>
          <span class="text-2xl md:text-3xl font-bold font-mono text-secondary-foreground">{{ stats?.expiringThisMonth || 0 }}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium text-muted-foreground">已过期</CardTitle>
          <AlertTriangle class="w-5 h-5 text-destructive" />
        </CardHeader>
        <CardContent>
          <span class="text-2xl md:text-3xl font-bold font-mono text-destructive">{{ stats?.expired || 0 }}</span>
        </CardContent>
      </Card>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-6">
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0">
          <CardTitle>即将到期的订阅</CardTitle>
          <Button as-child variant="link" class="px-0">
            <router-link to="/subscriptions">查看全部</router-link>
          </Button>
        </CardHeader>
        <CardContent>
          <EmptyState
            v-if="expiringSubs.length === 0"
            :icon="CheckCircle"
            title="暂无即将到期的订阅"
            description="所有订阅都在有效期内"
          />
          <div v-else class="space-y-2">
            <div
              v-for="sub in expiringSubs"
              :key="sub.id"
              class="flex items-center justify-between p-3 rounded-md hover:bg-accent transition-colors cursor-pointer"
              @click="router.push({ name: 'subscription-edit', params: { id: sub.id } })"
            >
              <div class="flex items-center gap-3 min-w-0">
                <div
                  class="w-10 h-10 rounded-md flex items-center justify-center text-lg font-medium text-white shrink-0"
                  :style="{ backgroundColor: getGroupColor(sub.groupId) }"
                >
                  {{ sub.icon || sub.name.charAt(0) }}
                </div>
                <div class="min-w-0">
                  <p class="font-medium leading-tight truncate">{{ sub.name }}</p>
                  <p class="text-sm text-muted-foreground">{{ formatExpireDate(sub.expireDate) }}</p>
                </div>
              </div>
              <Badge
                v-if="getExpireStatus(sub.expireDate) !== 'normal'"
                :variant="getExpireStatus(sub.expireDate) === 'warning' ? 'warning' : 'destructive'"
                class="shrink-0"
              >
                {{ expireLabel(sub.expireDate) }}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>快捷统计</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="space-y-3">
            <div class="flex items-center justify-between p-3 rounded-md bg-muted">
              <div class="flex items-center gap-3">
                <FolderTree class="w-5 h-5 text-primary" />
                <span class="text-muted-foreground">分组数量</span>
              </div>
              <span class="font-mono text-xl font-semibold">{{ stats?.totalGroups || 0 }}</span>
            </div>

            <div class="flex items-center justify-between p-3 rounded-md bg-muted">
              <div class="flex items-center gap-3">
                <Bell class="w-5 h-5 text-success" />
                <span class="text-muted-foreground">已配置渠道</span>
              </div>
              <span class="font-mono text-xl font-semibold">{{ stats?.totalChannels || 0 }}</span>
            </div>
          </div>

          <div class="mt-6 grid grid-cols-2 gap-4">
            <Button as-child variant="outline">
              <router-link to="/groups">管理分组</router-link>
            </Button>
            <Button as-child variant="outline">
              <router-link to="/channels">管理渠道</router-link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
