<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useSubscriptionStore, useGroupStore } from '@/stores'
import { ArrowLeft, Save, Calendar, Repeat, CalendarDays } from 'lucide-vue-next'
import type { Subscription } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isRecurring, toRecurringValue, getRecurringMonthDay } from '@/lib/date'

const router = useRouter()
const route = useRoute()
const subscriptionStore = useSubscriptionStore()
const groupStore = useGroupStore()

const isEdit = computed(() => !!route.params.id)
const loading = ref(false)
const error = ref('')

// 到期日期模式：recurring=周期（每年重复），once=非周期（一次性）
type ExpireMode = 'recurring' | 'once'
const expireMode = ref<ExpireMode>('once')

// 非周期模式：完整日期 YYYY-MM-DD
const expireDateOnce = ref('')
// 周期模式：用 date input 显示（固定用当前年），提交时只取 MM-DD
const expireDateRecurring = ref('')

// 延续设置：仅周期模式可见
// expire = 以设置到期时间延续周期天数 / current = 以当前时间延续周期天数
type ExtendMode = 'expire' | 'current'
const extendMode = ref<ExtendMode>('expire')

const form = ref({
  name: '',
  description: '',
  icon: '',
  amount: undefined as number | undefined,
  currency: 'CNY',
  renewalPeriod: 'monthly' as Subscription['renewalPeriod'],
  reminderDays: 7 as number,
  customRenewalDays: 30 as number,
  groupId: '' as string | undefined
})

onMounted(async () => {
  await groupStore.fetchGroups()

  if (isEdit.value) {
    const id = route.params.id as string
    await subscriptionStore.fetchSubscriptions()
    const sub = subscriptionStore.subscriptions.find(s => s.id === id)
    if (sub) {
      form.value = {
        name: sub.name,
        description: sub.description || '',
        icon: sub.icon || '',
        amount: sub.amount,
        currency: sub.currency || 'CNY',
        renewalPeriod: sub.renewalPeriod || 'monthly',
        reminderDays: sub.reminderDays,
        customRenewalDays: sub.customRenewalDays || 30,
        groupId: sub.groupId
      }

      // 根据存储格式还原表单
      if (isRecurring(sub.expireDate)) {
        expireMode.value = 'recurring'
        const md = getRecurringMonthDay(sub.expireDate) // MM-DD
        // 用当前年份填充，便于 date input 显示
        const year = new Date().getFullYear()
        expireDateRecurring.value = `${year}-${md}`
      } else {
        expireMode.value = 'once'
        expireDateOnce.value = sub.expireDate
      }

      // 还原延续模式（仅周期模式有意义，默认 expire）
      extendMode.value = sub.extendMode === 'current' ? 'current' : 'expire'

      // 还原提醒设置：预设值直接选中，非预设值切换到自定义模式
      if (!reminderOptions.some(o => o.value === sub.reminderDays)) {
        isCustomReminder.value = true
        customDayInput.value = sub.reminderDays
      } else {
        isCustomReminder.value = false
      }
    }
  }
})

// 提醒选项：1, 3, 7, 14, 30 天 + 自定义（单选）
const reminderOptions = [
  { value: 1, label: '1 天前' },
  { value: 3, label: '3 天前' },
  { value: 7, label: '7 天前' },
  { value: 14, label: '14 天前' },
  { value: 30, label: '30 天前' }
]

// 是否使用自定义天数
const isCustomReminder = ref(false)
const customDayInput = ref<number | undefined>()

function selectReminder(day: number) {
  form.value.reminderDays = day
  isCustomReminder.value = false
}

function selectCustomReminder() {
  isCustomReminder.value = true
  // 若已有自定义值则保留，否则清空等待输入
  if (!customDayInput.value) {
    form.value.reminderDays = 0
  } else {
    form.value.reminderDays = customDayInput.value
  }
}

function commitCustomDay() {
  const day = customDayInput.value
  if (day === undefined || day === null || isNaN(day) || day < 1 || day > 365) {
    return
  }
  form.value.reminderDays = day
}

// 获取最终提交用的到期日期值
function getExpireDateForSubmit(): string {
  if (expireMode.value === 'recurring') {
    if (!expireDateRecurring.value) return ''
    // 提取 MM-DD 部分
    const parts = expireDateRecurring.value.split('-')
    if (parts.length !== 3) return ''
    const month = parts[1]
    const day = parts[2]
    return toRecurringValue(`${month}-${day}`)
  }
  return expireDateOnce.value
}

async function handleSubmit() {
  const expireDate = getExpireDateForSubmit()
  if (!form.value.name || !expireDate) {
    error.value = '请填写必填项（订阅名称、到期日期）'
    return
  }

  // 校验提醒天数
  if (isCustomReminder.value) {
    commitCustomDay()
  }
  if (!form.value.reminderDays || form.value.reminderDays < 1 || form.value.reminderDays > 365) {
    error.value = '提醒天数必须在 1-365 之间'
    return
  }

  // 校验自定义续费天数
  if (expireMode.value === 'recurring' && form.value.renewalPeriod === 'custom') {
    if (!form.value.customRenewalDays || form.value.customRenewalDays < 1 || form.value.customRenewalDays > 3650) {
      error.value = '自定义续费天数必须在 1-3650 之间'
      return
    }
  }

  loading.value = true
  error.value = ''

  try {
    const data = {
      ...form.value,
      expireDate,
      // 非周期模式不传 extendMode（后端会保留默认值）
      extendMode: expireMode.value === 'recurring' ? extendMode.value : undefined,
      // 仅周期模式且 custom 时传 customRenewalDays
      customRenewalDays: expireMode.value === 'recurring' ? form.value.customRenewalDays : undefined,
      groupId: form.value.groupId || undefined
    }

    if (isEdit.value) {
      await subscriptionStore.updateSubscription(route.params.id as string, data)
    } else {
      await subscriptionStore.createSubscription(data)
    }
    router.push({ name: 'subscriptions' })
  } catch (e) {
    error.value = '保存失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="animate-fade-in max-w-2xl">
    <div class="flex items-center gap-4 mb-4 md:mb-8">
      <Button variant="ghost" size="icon" @click="router.back()">
        <ArrowLeft class="w-5 h-5" />
      </Button>
      <h1 class="text-xl md:text-2xl font-bold">{{ isEdit ? '编辑订阅' : '添加订阅' }}</h1>
    </div>

    <form @submit.prevent="handleSubmit">
      <Card>
        <CardHeader>
          <CardTitle>订阅信息</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4 md:space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <div class="space-y-2">
              <Label for="name">订阅名称 *</Label>
              <Input
                id="name"
                v-model="form.name"
                type="text"
                placeholder="例如：Netflix"
                required
              />
            </div>

            <div class="space-y-2">
              <Label for="icon">图标 Emoji</Label>
              <Input
                id="icon"
                v-model="form.icon"
                type="text"
                placeholder="例如：📺"
                maxlength="2"
              />
            </div>
          </div>

          <div class="space-y-2">
            <Label for="description">描述</Label>
            <textarea
              id="description"
              v-model="form.description"
              class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="订阅的简要描述..."
            ></textarea>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <div class="space-y-2">
              <Label for="amount">费用</Label>
              <Input
                id="amount"
                v-model.number="form.amount"
                type="number"
                step="0.01"
                placeholder="0.00"
              />
            </div>

            <div class="space-y-2">
              <Label for="currency">货币</Label>
              <select
                id="currency"
                v-model="form.currency"
                class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="CNY">CNY (¥)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
          </div>

          <div class="space-y-2">
            <Label for="groupId">分组</Label>
            <select
              id="groupId"
              v-model="form.groupId"
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="">无分组</option>
              <option v-for="group in groupStore.groups" :key="group.id" :value="group.id">
                {{ group.name }}
              </option>
            </select>
          </div>

          <!-- 到期日期：双模式 -->
          <div class="space-y-3">
            <Label>到期日期 *</Label>

            <!-- 模式切换 -->
            <div class="grid grid-cols-2 gap-2 p-1 rounded-lg bg-muted">
              <button
                type="button"
                class="flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                :class="expireMode === 'recurring' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'"
                @click="expireMode = 'recurring'"
              >
                <Repeat class="w-4 h-4" />
                周期模式
              </button>
              <button
                type="button"
                class="flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                :class="expireMode === 'once' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'"
                @click="expireMode = 'once'"
              >
                <CalendarDays class="w-4 h-4" />
                非周期模式
              </button>
            </div>

            <!-- 周期模式：月日 + 续费周期 -->
            <div v-if="expireMode === 'recurring'" class="space-y-4">
              <div class="space-y-2">
                <div class="relative">
                  <Calendar class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                  <Input
                    v-model="expireDateRecurring"
                    type="date"
                    class="pl-9"
                    required
                  />
                </div>
                <p class="text-xs text-muted-foreground">
                  选择月日即可，系统将每年此日期重复提醒。年份会被忽略。
                </p>
              </div>

              <!-- 续费周期（仅周期模式显示） -->
              <div class="space-y-2">
                <Label for="renewalPeriod">续费周期</Label>
                <select
                  id="renewalPeriod"
                  v-model="form.renewalPeriod"
                  class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="monthly">每月</option>
                  <option value="yearly">每年</option>
                  <option value="custom">自定义</option>
                </select>
              </div>

              <!-- 自定义续费天数（仅续费周期为 custom 时显示） -->
              <div v-if="form.renewalPeriod === 'custom'" class="space-y-2">
                <Label for="customRenewalDays">自定义续费天数</Label>
                <div class="flex items-center gap-2">
                  <Input
                    id="customRenewalDays"
                    v-model.number="form.customRenewalDays"
                    type="number"
                    min="1"
                    max="3650"
                    placeholder="30"
                    class="flex-1"
                  />
                  <span class="text-sm text-muted-foreground whitespace-nowrap">天</span>
                </div>
                <p class="text-xs text-muted-foreground">
                  一键续期时按此天数推后到期日期（范围 1-3650 天）。
                </p>
              </div>

              <!-- 延续设置（仅周期模式显示） -->
              <div class="space-y-2">
                <Label>延续设置</Label>
                <div class="grid grid-cols-2 gap-2 p-1 rounded-lg bg-muted">
                  <button
                    type="button"
                    class="px-3 py-2 rounded-md text-sm font-medium transition-colors text-center"
                    :class="extendMode === 'expire' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'"
                    @click="extendMode = 'expire'"
                  >
                    以到期日延续
                  </button>
                  <button
                    type="button"
                    class="px-3 py-2 rounded-md text-sm font-medium transition-colors text-center"
                    :class="extendMode === 'current' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'"
                    @click="extendMode = 'current'"
                  >
                    以当前日期延续
                  </button>
                </div>
                <p class="text-xs text-muted-foreground">
                  一键续期时的计算基准：以到期日延续=从当前到期日推后一个周期；以当前日期延续=从今天推后一个周期。
                </p>
              </div>
            </div>

            <!-- 非周期模式：完整日期，无续费周期 -->
            <div v-else class="space-y-2">
              <div class="relative">
                <CalendarDays class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                <Input
                  v-model="expireDateOnce"
                  type="date"
                  class="pl-9"
                  required
                />
              </div>
              <p class="text-xs text-muted-foreground">
                选择具体日期，到期后不再重复。
              </p>
            </div>
          </div>

          <!-- 提醒设置：单选（1/3/7/14/30 + 自定义） -->
          <div class="space-y-2">
            <Label>提醒设置</Label>
            <div class="flex flex-wrap items-center gap-2">
              <Button
                v-for="option in reminderOptions"
                :key="option.value"
                type="button"
                :variant="(!isCustomReminder && form.reminderDays === option.value) ? 'default' : 'outline'"
                size="sm"
                @click="selectReminder(option.value)"
              >
                {{ option.label }}
              </Button>

              <!-- 自定义单选按钮 -->
              <Button
                type="button"
                :variant="isCustomReminder ? 'default' : 'outline'"
                size="sm"
                @click="selectCustomReminder"
              >
                自定义
              </Button>

              <!-- 自定义输入框（选中自定义时显示） -->
              <div v-if="isCustomReminder" class="flex items-center gap-2">
                <Input
                  v-model.number="customDayInput"
                  type="number"
                  min="1"
                  max="365"
                  placeholder="天数"
                  class="w-20 h-8"
                  @input="commitCustomDay"
                  @keyup.enter="commitCustomDay"
                />
                <span class="text-sm text-muted-foreground">天前</span>
              </div>
            </div>
            <p class="text-xs text-muted-foreground">
              选择到期前几天发送提醒通知（单选），自定义范围 1-365 天。
            </p>
          </div>

          <div v-if="error" class="text-destructive text-sm">
            {{ error }}
          </div>
        </CardContent>
        <CardFooter class="gap-4">
          <Button type="button" variant="outline" class="flex-1" @click="router.back()">取消</Button>
          <Button type="submit" class="flex-1" :disabled="loading">
            <Save class="w-4 h-4" />
            保存
          </Button>
        </CardFooter>
      </Card>
    </form>
  </div>
</template>
