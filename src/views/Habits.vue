<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { api } from '@/api/client'
import type { Habit, HabitRecord, HabitStats, HabitFrequency } from '@/api/client'
import {
  Plus, Flame, Check, Trash2, Edit2, Target, Calendar,
  ChevronLeft, ChevronRight
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog'

/* =========================================================================
 * 状态
 * ========================================================================= */

const habits = ref<Habit[]>([])
const stats = ref<HabitStats | null>(null)
const recordsMap = ref<Record<string, HabitRecord[]>>({})
const loading = ref(false)
const saving = ref(false)

const weekOffset = ref(0) // 0=本周，-1=上周，1=下周

// 表单对话框
const showForm = ref(false)
const editingHabit = ref<Habit | null>(null)

// 删除确认对话框
const showDeleteConfirm = ref(false)
const deleteTarget = ref<Habit | null>(null)

// 颜色预设
const COLOR_PRESETS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#EF4444',
  '#F59E0B', '#10B981', '#3B82F6', '#14B8A6'
]

// 频率选项
const FREQUENCY_OPTIONS: { value: HabitFrequency; label: string }[] = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'custom', label: '自定义' }
]

// 星期选项（1=周一 ... 7=周日）
const WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' }
]

// 表单数据
const form = ref({
  name: '',
  color: COLOR_PRESETS[0],
  frequency: 'daily' as HabitFrequency,
  weeklyDays: [] as number[],
  customDays: 2,
  goal: 1,
  enableReminder: false,
  remindTime: ''
})

// 正在切换打卡的项（防止重复点击）
const toggling = ref<Set<string>>(new Set())

/* =========================================================================
 * 工具函数
 * ========================================================================= */

/** 本地日期 -> YYYY-MM-DD */
function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 今天的字符串 */
function getTodayStr(): string {
  return toISODate(new Date())
}

/** 某日期字符串减去 n 天 */
function subDaysStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - n)
  return toISODate(d)
}

/** 获取当前周（含 offset）的 7 个日期，周一到周日 */
function getWeekDates(offset = 0): string[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // 0=周日 ... 6=周六；将其转换为「距周一的偏移」
  const day = today.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(today)
  monday.setDate(today.getDate() + diffToMonday + offset * 7)

  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    dates.push(toISODate(d))
  }
  return dates
}

/** 格式化为「6月30日」 */
function formatMD(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 取日期中的「日」 */
function dayOfMonth(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getDate()
}

/* =========================================================================
 * 派生数据
 * ========================================================================= */

const todayStr = getTodayStr()
const weekDates = computed(() => getWeekDates(weekOffset.value))

const weekRangeLabel = computed(() => {
  const dates = weekDates.value
  return `${formatMD(dates[0])} - ${formatMD(dates[6])}`
})

const isCurrentWeek = computed(() => weekOffset.value === 0)

// 今日已打卡习惯数（本地计算，与网格保持一致）
const todayCompletedCount = computed(() => {
  return habits.value.filter(h => isChecked(h, todayStr)).length
})

/* =========================================================================
 * 习惯相关展示函数
 * ========================================================================= */

/** 频率描述：每天 / 每周一三五 / 每3天 */
function frequencyLabel(h: Habit): string {
  if (h.frequency === 'daily') return '每天'
  if (h.frequency === 'weekly') {
    const days = (h.weeklyDays || '')
      .split(',')
      .map(s => Number(s))
      .filter(n => n >= 1 && n <= 7)
      .sort((a, b) => a - b)
    if (days.length === 0) return '每周'
    const names = ['', '一', '二', '三', '四', '五', '六', '日']
    return '每周' + days.map(d => names[d]).join('')
  }
  return `每${h.customDays || 1}天`
}

/** 某天是否已打卡 */
function isChecked(habit: Habit, dateStr: string): boolean {
  const recs = recordsMap.value[habit.id]
  return !!recs && recs.some(r => r.date === dateStr)
}

/** 某天是否为未来（不可打卡） */
function isFuture(dateStr: string): boolean {
  return dateStr > todayStr
}

/** 是否为今天 */
function isToday(dateStr: string): boolean {
  return dateStr === todayStr
}

/**
 * 连续打卡天数（简化版）：从今天往前数，遇到没记录就断。
 * 注意：若今天尚未打卡，则 streak = 0。
 */
function streakOf(habit: Habit): number {
  const recs = recordsMap.value[habit.id]
  if (!recs || recs.length === 0) return 0
  const dates = new Set(recs.map(r => r.date))
  let streak = 0
  const d = new Date(todayStr + 'T00:00:00')
  while (true) {
    const ds = toISODate(d)
    if (dates.has(ds)) {
      streak++
      d.setDate(d.getDate() - 1)
    } else {
      break
    }
  }
  return streak
}

function toggleKey(habitId: string, date: string): string {
  return `${habitId}|${date}`
}

function isToggling(habitId: string, date: string): boolean {
  return toggling.value.has(toggleKey(habitId, date))
}

/* =========================================================================
 * 数据加载
 * ========================================================================= */

async function loadAll() {
  loading.value = true
  try {
    // 取最近一年记录用于计算 streak 与历史周网格展示
    const start = subDaysStr(todayStr, 365)
    const [habitsRes, statsRes, recordsRes] = await Promise.all([
      api.getHabits(),
      api.getHabitStats(),
      api.getAllHabitRecords(start, todayStr)
    ])
    if (habitsRes.success && habitsRes.data) habits.value = habitsRes.data
    if (statsRes.success && statsRes.data) stats.value = statsRes.data
    if (recordsRes.success && recordsRes.data) recordsMap.value = recordsRes.data
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  const res = await api.getHabitStats()
  if (res.success && res.data) stats.value = res.data
}

onMounted(() => {
  loadAll()
})

/* =========================================================================
 * 打卡交互
 * ========================================================================= */

async function toggleDay(habit: Habit, dateStr: string) {
  if (isFuture(dateStr)) return
  const key = toggleKey(habit.id, dateStr)
  if (toggling.value.has(key)) return
  toggling.value.add(key)

  const checked = isChecked(habit, dateStr)
  try {
    if (checked) {
      // 撤销当天全部打卡
      const res = await api.undoHabitRecordsByDate(habit.id, dateStr)
      if (res.success) {
        recordsMap.value[habit.id] = (recordsMap.value[habit.id] || [])
          .filter(r => r.date !== dateStr)
        await loadStats()
      }
    } else {
      // 创建打卡记录
      const res = await api.createHabitRecord({ habitId: habit.id, date: dateStr })
      if (res.success && res.data) {
        if (!recordsMap.value[habit.id]) recordsMap.value[habit.id] = []
        recordsMap.value[habit.id].push(res.data)
        await loadStats()
      }
    }
  } finally {
    toggling.value.delete(key)
  }
}

/* =========================================================================
 * 添加 / 编辑习惯
 * ========================================================================= */

function openForm(habit?: Habit) {
  if (habit) {
    editingHabit.value = habit
    form.value = {
      name: habit.name,
      color: habit.color || COLOR_PRESETS[0],
      frequency: habit.frequency,
      weeklyDays: (habit.weeklyDays || '')
        .split(',')
        .map(s => Number(s))
        .filter(n => n >= 1 && n <= 7),
      customDays: habit.customDays || 2,
      goal: habit.goal || 1,
      enableReminder: !!habit.remindTime,
      remindTime: habit.remindTime || ''
    }
  } else {
    editingHabit.value = null
    form.value = {
      name: '',
      color: COLOR_PRESETS[0],
      frequency: 'daily',
      weeklyDays: [],
      customDays: 2,
      goal: 1,
      enableReminder: false,
      remindTime: ''
    }
  }
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  editingHabit.value = null
}

function toggleWeekday(n: number) {
  const idx = form.value.weeklyDays.indexOf(n)
  if (idx === -1) form.value.weeklyDays.push(n)
  else form.value.weeklyDays.splice(idx, 1)
}

async function saveForm() {
  const name = form.value.name.trim()
  if (!name) return

  saving.value = true
  try {
    const payload: Partial<Habit> = {
      name,
      color: form.value.color,
      frequency: form.value.frequency,
      weeklyDays:
        form.value.frequency === 'weekly'
          ? form.value.weeklyDays.slice().sort((a, b) => a - b).join(',') || null
          : null,
      customDays: form.value.frequency === 'custom' ? Math.max(1, Number(form.value.customDays) || 1) : 1,
      goal: Math.max(1, Number(form.value.goal) || 1),
      remindTime: form.value.enableReminder && form.value.remindTime ? form.value.remindTime : null
    }

    if (editingHabit.value) {
      const res = await api.updateHabit(editingHabit.value.id, payload)
      if (!res.success) return
    } else {
      const res = await api.createHabit(payload)
      if (!res.success) return
    }
    await loadAll()
    closeForm()
  } finally {
    saving.value = false
  }
}

/* =========================================================================
 * 删除习惯
 * ========================================================================= */

function openDelete(habit: Habit) {
  deleteTarget.value = habit
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  const target = deleteTarget.value
  const res = await api.deleteHabit(target.id)
  if (res.success) {
    // 本地同步移除
    habits.value = habits.value.filter(h => h.id !== target.id)
    delete recordsMap.value[target.id]
    await loadStats()
  }
  showDeleteConfirm.value = false
  deleteTarget.value = null
}
</script>

<template>
  <div class="animate-fade-in pb-10">
    <!-- 页面标题 -->
    <div class="flex items-center justify-between mb-6 gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <div class="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] text-white shrink-0">
          <Flame class="w-5 h-5" />
        </div>
        <div class="min-w-0">
          <h1 class="text-xl md:text-2xl font-bold truncate">习惯打卡</h1>
          <p class="text-xs text-muted-foreground hidden sm:block">坚持小事，养成好习惯</p>
        </div>
      </div>
      <Button @click="openForm()">
        <Plus class="w-4 h-4" />
        添加习惯
      </Button>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-3 gap-3 mb-6">
      <Card class="p-4">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Target class="w-4 h-4" />
          <span class="text-xs">总习惯数</span>
        </div>
        <div class="text-2xl font-bold mt-2">{{ habits.length }}</div>
      </Card>
      <Card class="p-4">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Check class="w-4 h-4" />
          <span class="text-xs">今日已打卡</span>
        </div>
        <div class="text-2xl font-bold mt-2">
          {{ todayCompletedCount }}<span class="text-sm text-muted-foreground font-normal"> / {{ habits.length }}</span>
        </div>
      </Card>
      <Card class="p-4">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Flame class="w-4 h-4" />
          <span class="text-xs">累计打卡次数</span>
        </div>
        <div class="text-2xl font-bold mt-2">{{ stats?.totalCheckIns ?? 0 }}</div>
      </Card>
    </div>

    <!-- 本周导航 -->
    <div class="flex items-center justify-between mb-4 gap-2">
      <div class="flex items-center gap-2">
        <Button variant="outline" size="icon" class="h-8 w-8" @click="weekOffset--">
          <ChevronLeft class="w-4 h-4" />
        </Button>
        <div class="flex items-center gap-2 min-w-[150px] justify-center">
          <Calendar class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ weekRangeLabel }}</span>
          <Badge v-if="isCurrentWeek" variant="secondary" class="text-xs">本周</Badge>
        </div>
        <Button variant="outline" size="icon" class="h-8 w-8" @click="weekOffset++">
          <ChevronRight class="w-4 h-4" />
        </Button>
      </div>
      <Button v-if="!isCurrentWeek" variant="ghost" size="sm" @click="weekOffset = 0">
        回到本周
      </Button>
    </div>

    <!-- 加载骨架 -->
    <div v-if="loading" class="space-y-3">
      <Card v-for="i in 3" :key="i" class="p-4">
        <Skeleton class="h-5 w-1/3 mb-3" />
        <Skeleton class="h-8 w-full" />
      </Card>
    </div>

    <!-- 空状态 -->
    <Card
      v-else-if="habits.length === 0"
      class="border-dashed flex flex-col items-center justify-center p-10 text-center"
    >
      <div class="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Flame class="h-7 w-7 text-muted-foreground" />
      </div>
      <h3 class="mt-4 text-lg font-semibold">还没有习惯</h3>
      <p class="mt-2 text-sm text-muted-foreground">点击右上角添加第一个习惯吧</p>
      <Button class="mt-4" @click="openForm()">
        <Plus class="w-4 h-4" />
        添加习惯
      </Button>
    </Card>

    <!-- 习惯列表 -->
    <div v-else class="space-y-3">
      <Card
        v-for="habit in habits"
        :key="habit.id"
        class="p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group"
        @click="openForm(habit)"
      >
        <!-- 顶部信息行 -->
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <!-- 左：圆点 + 名称 + 频率 -->
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <span
              class="w-3.5 h-3.5 rounded-full shrink-0"
              :style="{ backgroundColor: habit.color }"
            />
            <div class="min-w-0">
              <div class="font-medium truncate">{{ habit.name }}</div>
              <div class="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                <span>{{ frequencyLabel(habit) }}</span>
                <span>·</span>
                <span>目标 {{ habit.goal }}次/天</span>
                <template v-if="habit.remindTime">
                  <span>·</span>
                  <span>{{ habit.remindTime }}</span>
                </template>
              </div>
            </div>
          </div>

          <!-- 中：连续打卡天数 -->
          <div
            class="flex items-center gap-1 text-sm shrink-0 px-2 py-1 rounded-full"
            :class="streakOf(habit) > 0 ? 'text-orange-500 bg-orange-500/10' : 'text-muted-foreground bg-muted'"
          >
            <Flame
              class="w-4 h-4"
              :class="streakOf(habit) > 0 ? 'fill-orange-500/30' : ''"
            />
            <span class="font-medium">{{ streakOf(habit) }}天</span>
          </div>

          <!-- 右：操作按钮 -->
          <div class="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              @click.stop="openForm(habit)"
            >
              <Edit2 class="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-destructive hover:text-destructive"
              @click.stop="openDelete(habit)"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <!-- 本周 7 天打卡网格 -->
        <div
          class="mt-4 grid grid-cols-7 gap-1"
          @click.stop
        >
          <div
            v-for="(d, i) in weekDates"
            :key="d"
            class="flex flex-col items-center gap-1"
          >
            <span class="text-xs text-muted-foreground">{{ WEEKDAY_OPTIONS[i].label }}</span>
            <button
              class="relative w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all"
              :class="[
                isChecked(habit, d)
                  ? 'border-transparent text-white'
                  : isFuture(d)
                    ? 'border-muted/30 bg-muted/20 text-transparent cursor-not-allowed'
                    : 'border-muted-foreground/25 text-transparent hover:border-primary hover:scale-105',
                isToday(d) && !isChecked(habit, d) ? 'ring-2 ring-primary/40 ring-offset-1 ring-offset-background' : '',
                isToggling(habit.id, d) ? 'opacity-60' : ''
              ]"
              :style="isChecked(habit, d) ? { backgroundColor: habit.color, borderColor: habit.color } : {}"
              :disabled="isFuture(d)"
              @click="toggleDay(habit, d)"
            >
              <Check v-if="isChecked(habit, d)" class="w-4 h-4" />
              <span
                v-if="!isChecked(habit, d)"
                class="text-[10px] text-muted-foreground/60"
              >{{ dayOfMonth(d) }}</span>
            </button>
          </div>
        </div>
      </Card>
    </div>

    <!-- 添加 / 编辑习惯对话框 -->
    <Dialog :open="showForm" @update:open="(v) => { if (!v) closeForm() }">
      <DialogContent class="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{ editingHabit ? '编辑习惯' : '添加习惯' }}</DialogTitle>
          <DialogDescription>
            {{ editingHabit ? '修改习惯信息后点击保存' : '创建一个新的打卡习惯' }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <!-- 名称 -->
          <div class="space-y-2">
            <Label>习惯名称 <span class="text-destructive">*</span></Label>
            <Input
              v-model="form.name"
              placeholder="例如：早起、阅读、运动"
              maxlength="40"
            />
          </div>

          <!-- 颜色 -->
          <div class="space-y-2">
            <Label>颜色</Label>
            <div class="flex items-center gap-2 flex-wrap">
              <button
                v-for="color in COLOR_PRESETS"
                :key="color"
                class="w-7 h-7 rounded-full border-2 transition-transform"
                :class="form.color === color ? 'scale-110 border-foreground' : 'border-transparent hover:scale-105'"
                :style="{ backgroundColor: color }"
                @click="form.color = color"
              />
            </div>
          </div>

          <!-- 频率 -->
          <div class="space-y-2">
            <Label>频率</Label>
            <div class="flex items-center gap-2">
              <button
                v-for="opt in FREQUENCY_OPTIONS"
                :key="opt.value"
                class="px-3 py-1.5 rounded-md border text-sm transition-colors flex-1"
                :class="form.frequency === opt.value ? 'bg-secondary border-primary font-medium' : 'hover:bg-accent'"
                @click="form.frequency = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>

            <!-- 每周：星期选择 -->
            <div v-if="form.frequency === 'weekly'" class="flex items-center gap-1.5 pt-1">
              <button
                v-for="opt in WEEKDAY_OPTIONS"
                :key="opt.value"
                class="w-9 h-9 rounded-md border text-sm transition-colors flex items-center justify-center"
                :class="form.weeklyDays.includes(opt.value) ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'"
                @click="toggleWeekday(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>

            <!-- 自定义：间隔天数 -->
            <div v-if="form.frequency === 'custom'" class="flex items-center gap-2 pt-1">
              <span class="text-sm text-muted-foreground">每</span>
              <Input
                v-model.number="form.customDays"
                type="number"
                min="1"
                max="365"
                class="w-20"
              />
              <span class="text-sm text-muted-foreground">天打卡一次</span>
            </div>
          </div>

          <!-- 每日目标 -->
          <div class="space-y-2">
            <Label>每日目标</Label>
            <div class="flex items-center gap-2">
              <Input
                v-model.number="form.goal"
                type="number"
                min="1"
                max="99"
                class="w-24"
              />
              <span class="text-sm text-muted-foreground">次/天</span>
            </div>
          </div>

          <!-- 提醒 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <Label>开启提醒</Label>
              <Switch
                :checked="form.enableReminder"
                @update:checked="(v) => form.enableReminder = v"
              />
            </div>
            <div v-if="form.enableReminder" class="flex items-center gap-2">
              <Input
                v-model="form.remindTime"
                type="time"
                class="w-40"
              />
              <span class="text-xs text-muted-foreground">每天提醒打卡</span>
            </div>
          </div>
        </div>

        <DialogFooter class="gap-2">
          <Button variant="outline" @click="closeForm">取消</Button>
          <Button :disabled="!form.name.trim() || saving" @click="saveForm">
            {{ editingHabit ? '保存' : '创建' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 删除确认对话框 -->
    <Dialog :open="showDeleteConfirm" @update:open="(v) => { if (!v) { showDeleteConfirm = false; deleteTarget = null } }">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
          <DialogDescription>
            确定要删除习惯「{{ deleteTarget?.name }}」吗？该习惯的全部打卡记录也会被清除，此操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showDeleteConfirm = false; deleteTarget = null">取消</Button>
          <Button variant="destructive" @click="confirmDelete">删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
