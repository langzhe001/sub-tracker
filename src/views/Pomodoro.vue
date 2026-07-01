<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  Play, Pause, RotateCcw, Timer, Coffee, Settings, X
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog'

/* =========================================================================
 * 类型定义
 * ========================================================================= */

type Mode = 'focus' | 'shortBreak' | 'longBreak'

interface PomodoroSettings {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  longBreakInterval: number
  autoStart: boolean
}

interface SessionRecord {
  date: string // YYYY-MM-DD
  count: number
}

/* =========================================================================
 * 常量
 * ========================================================================= */

const SETTINGS_KEY = 'pomodoro_settings'
const SESSIONS_KEY = 'pomodoro_sessions_today'

const DEFAULT_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStart: false,
}

const MODES: Mode[] = ['focus', 'shortBreak', 'longBreak']

interface ModeConfig {
  label: string
  text: string
  ring: string
  activeBg: string
  bar: string
  gradient: string
}

const MODE_CONFIG: Record<Mode, ModeConfig> = {
  focus: {
    label: '专注',
    text: 'text-red-500',
    ring: 'text-red-500',
    activeBg: 'bg-red-500/15 text-red-500',
    bar: 'bg-red-500',
    gradient: 'from-red-500 to-orange-500',
  },
  shortBreak: {
    label: '短休息',
    text: 'text-green-500',
    ring: 'text-green-500',
    activeBg: 'bg-green-500/15 text-green-500',
    bar: 'bg-green-500',
    gradient: 'from-green-500 to-emerald-500',
  },
  longBreak: {
    label: '长休息',
    text: 'text-blue-500',
    ring: 'text-blue-500',
    activeBg: 'bg-blue-500/15 text-blue-500',
    bar: 'bg-blue-500',
    gradient: 'from-blue-500 to-cyan-500',
  },
}

// 圆形进度环参数
const RADIUS = 90
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/* =========================================================================
 * 状态
 * ========================================================================= */

const mode = ref<Mode>('focus')
const remainingSeconds = ref(DEFAULT_SETTINGS.focusMinutes * 60)
const isRunning = ref(false)
const completedSessions = ref(0)
const settings = ref<PomodoroSettings>({ ...DEFAULT_SETTINGS })
const showSettings = ref(false)
const settingsForm = ref<PomodoroSettings>({ ...DEFAULT_SETTINGS })
const tip = ref('')
const showTip = ref(false)

let timer: ReturnType<typeof setInterval> | null = null
let targetEndTime = 0 // 计时结束时间戳，用于精确计时、避免 setInterval 漂移
let tipTimer: ReturnType<typeof setTimeout> | null = null

/* =========================================================================
 * 工具函数
 * ========================================================================= */

/** 格式化秒数为 MM:SS */
function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** 今天日期字符串 YYYY-MM-DD */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 数值钳制到 [min, max]，非法值返回 min */
function clamp(v: unknown, min: number, max: number): number {
  const n = Math.floor(Number(v))
  if (Number.isNaN(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** 获取某模式的总秒数 */
function getModeSeconds(m: Mode): number {
  switch (m) {
    case 'focus': return settings.value.focusMinutes * 60
    case 'shortBreak': return settings.value.shortBreakMinutes * 60
    case 'longBreak': return settings.value.longBreakMinutes * 60
  }
}

/* =========================================================================
 * localStorage 持久化
 * ========================================================================= */

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const merged: PomodoroSettings = { ...DEFAULT_SETTINGS, ...parsed }
      merged.focusMinutes = clamp(merged.focusMinutes, 1, 90)
      merged.shortBreakMinutes = clamp(merged.shortBreakMinutes, 1, 30)
      merged.longBreakMinutes = clamp(merged.longBreakMinutes, 1, 60)
      merged.longBreakInterval = clamp(merged.longBreakInterval, 2, 8)
      merged.autoStart = !!merged.autoStart
      settings.value = merged
    }
  } catch {
    settings.value = { ...DEFAULT_SETTINGS }
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value))
  } catch {
    // 忽略写入异常
  }
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (raw) {
      const parsed: SessionRecord = JSON.parse(raw)
      // 同一天才沿用计数，跨天清零
      if (parsed.date === todayStr()) {
        completedSessions.value = clamp(parsed.count, 0, 9999)
        return
      }
    }
  } catch {
    // 忽略解析异常
  }
  completedSessions.value = 0
}

function saveSessions() {
  try {
    const record: SessionRecord = { date: todayStr(), count: completedSessions.value }
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(record))
  } catch {
    // 忽略写入异常
  }
}

/* =========================================================================
 * 计时器控制
 * ========================================================================= */

function startTimer() {
  if (isRunning.value) return
  isRunning.value = true
  targetEndTime = Date.now() + remainingSeconds.value * 1000
  timer = setInterval(tick, 1000)
  updateDocumentTitle()
}

function pauseTimer() {
  if (!isRunning.value) return
  isRunning.value = false
  targetEndTime = 0
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  updateDocumentTitle()
}

function toggleTimer() {
  if (isRunning.value) {
    pauseTimer()
  } else {
    startTimer()
  }
}

function tick() {
  if (targetEndTime > 0) {
    const diff = Math.ceil((targetEndTime - Date.now()) / 1000)
    remainingSeconds.value = Math.max(0, diff)
    if (remainingSeconds.value <= 0) {
      handleComplete()
    }
  }
}

/** 重置当前模式倒计时到初始时长 */
function resetTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  isRunning.value = false
  targetEndTime = 0
  remainingSeconds.value = getModeSeconds(mode.value)
  updateDocumentTitle()
}

/** 用户手动切换模式：停止当前计时并重置为新模式时长 */
function switchMode(newMode: Mode) {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  isRunning.value = false
  targetEndTime = 0
  mode.value = newMode
  remainingSeconds.value = getModeSeconds(newMode)
  updateDocumentTitle()
}

/** 应用某模式（重置时长），可选自动开始 */
function applyMode(newMode: Mode, autoStart: boolean) {
  mode.value = newMode
  remainingSeconds.value = getModeSeconds(newMode)
  updateDocumentTitle()
  if (autoStart) {
    startTimer()
  }
}

/** 倒计时结束处理：计数 +1、切换模式、提示 */
function handleComplete() {
  // 停止计时
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  isRunning.value = false
  targetEndTime = 0
  remainingSeconds.value = 0

  const finishedMode = mode.value
  let nextMode: Mode
  let message: string

  if (finishedMode === 'focus') {
    completedSessions.value += 1
    saveSessions()
    const isLong = completedSessions.value % settings.value.longBreakInterval === 0
    nextMode = isLong ? 'longBreak' : 'shortBreak'
    if (isLong) {
      message = `太棒了！已完成 ${completedSessions.value} 次专注，进入长休息好好放松一下`
    } else {
      message = `专注完成！已完成 ${completedSessions.value} 次专注，进入短休息`
    }
  } else {
    nextMode = 'focus'
    message = finishedMode === 'longBreak'
      ? '长休息结束，开始新的专注吧'
      : '休息结束，开始专注吧'
  }

  showTipMessage(message)
  applyMode(nextMode, settings.value.autoStart)
}

/* =========================================================================
 * 页面内提示
 * ========================================================================= */

function showTipMessage(message: string) {
  tip.value = message
  showTip.value = true
  if (tipTimer) {
    clearTimeout(tipTimer)
  }
  tipTimer = setTimeout(() => {
    showTip.value = false
    tipTimer = null
  }, 4000)
}

function dismissTip() {
  showTip.value = false
  if (tipTimer) {
    clearTimeout(tipTimer)
    tipTimer = null
  }
}

/* =========================================================================
 * 文档标题同步
 * ========================================================================= */

function updateDocumentTitle() {
  if (isRunning.value) {
    document.title = `${formatTime(remainingSeconds.value)} ${MODE_CONFIG[mode.value].label} - 番茄计时`
  } else {
    document.title = '番茄计时'
  }
}

// 剩余时间变化时同步标题（每秒）
watch(remainingSeconds, () => {
  if (isRunning.value) {
    document.title = `${formatTime(remainingSeconds.value)} ${MODE_CONFIG[mode.value].label} - 番茄计时`
  }
})

/* =========================================================================
 * 设置面板
 * ========================================================================= */

function openSettings() {
  settingsForm.value = { ...settings.value }
  showSettings.value = true
}

function closeSettings() {
  showSettings.value = false
}

function saveSettingsForm() {
  // 校验并钳制范围
  settingsForm.value.focusMinutes = clamp(settingsForm.value.focusMinutes, 1, 90)
  settingsForm.value.shortBreakMinutes = clamp(settingsForm.value.shortBreakMinutes, 1, 30)
  settingsForm.value.longBreakMinutes = clamp(settingsForm.value.longBreakMinutes, 1, 60)
  settingsForm.value.longBreakInterval = clamp(settingsForm.value.longBreakInterval, 2, 8)

  settings.value = { ...settingsForm.value }
  saveSettings()

  // 当前未运行时，更新倒计时为新时长
  if (!isRunning.value) {
    remainingSeconds.value = getModeSeconds(mode.value)
    updateDocumentTitle()
  }
  showSettings.value = false
}

/* =========================================================================
 * 派生数据
 * ========================================================================= */

const modeConfig = computed(() => MODE_CONFIG[mode.value])

const progress = computed(() => {
  const total = getModeSeconds(mode.value)
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, 1 - remainingSeconds.value / total))
})

const ringDashOffset = computed(() => CIRCUMFERENCE * (1 - progress.value))

// 当前周期内完成的专注数（如第 2 次，共 4 次）
const cycleCompleted = computed(() => completedSessions.value % settings.value.longBreakInterval)

// 距下次长休息还需专注的次数
const sessionsToLongBreak = computed(() => settings.value.longBreakInterval - cycleCompleted.value)

// 下一次专注完成是否会触发长休息
const nextIsLongBreak = computed(() => cycleCompleted.value === settings.value.longBreakInterval - 1)

// 是否处于初始状态（用于禁用重置按钮）
const isAtInitialState = computed(() => !isRunning.value && remainingSeconds.value >= getModeSeconds(mode.value))

// 主按钮样式：运行中=琥珀色（暂停），未运行=当前模式色（开始）
const mainButtonClass = computed(() => {
  if (isRunning.value) {
    return 'bg-amber-500 hover:bg-amber-600'
  }
  switch (mode.value) {
    case 'focus': return 'bg-red-500 hover:bg-red-600'
    case 'shortBreak': return 'bg-green-500 hover:bg-green-600'
    case 'longBreak': return 'bg-blue-500 hover:bg-blue-600'
  }
})

/* =========================================================================
 * 生命周期
 * ========================================================================= */

onMounted(() => {
  loadSettings()
  loadSessions()
  remainingSeconds.value = getModeSeconds(mode.value)
  updateDocumentTitle()
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (tipTimer) {
    clearTimeout(tipTimer)
    tipTimer = null
  }
  document.title = '番茄计时'
})
</script>

<template>
  <div class="animate-fade-in pb-10">
    <!-- 页面标题 -->
    <div class="flex items-center justify-between mb-6 gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <div
          class="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br text-white shrink-0 transition-all duration-300"
          :class="modeConfig.gradient"
        >
          <Timer class="w-5 h-5" />
        </div>
        <div class="min-w-0">
          <h1 class="text-xl md:text-2xl font-bold truncate">番茄计时</h1>
          <p class="text-xs text-muted-foreground hidden sm:block">保持专注，高效工作</p>
        </div>
      </div>
      <Button variant="outline" size="icon" @click="openSettings">
        <Settings class="w-4 h-4" />
      </Button>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-3 gap-3 mb-6">
      <Card class="p-4">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Timer class="w-4 h-4" />
          <span class="text-xs">今日已完成专注</span>
        </div>
        <div class="text-2xl font-bold mt-2">
          {{ completedSessions }}
          <span class="text-sm text-muted-foreground font-normal">次</span>
        </div>
      </Card>
      <Card class="p-4">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Coffee class="w-4 h-4" />
          <span class="text-xs">距下次长休息</span>
        </div>
        <div class="text-2xl font-bold mt-2">
          {{ sessionsToLongBreak }}
          <span class="text-sm text-muted-foreground font-normal">次专注</span>
        </div>
      </Card>
      <Card class="p-4">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Settings class="w-4 h-4" />
          <span class="text-xs">自动开始下一阶段</span>
        </div>
        <div class="text-2xl font-bold mt-2">
          {{ settings.autoStart ? '已开启' : '已关闭' }}
        </div>
      </Card>
    </div>

    <!-- 主计时卡片 -->
    <Card class="p-6 sm:p-8">
      <!-- 模式切换 -->
      <div class="flex justify-center mb-8">
        <div class="inline-flex items-center gap-1 p-1 rounded-full bg-muted/60">
          <button
            v-for="m in MODES"
            :key="m"
            class="px-4 sm:px-5 py-2 rounded-full text-sm font-medium transition-all"
            :class="mode === m
              ? MODE_CONFIG[m].activeBg
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'"
            @click="switchMode(m)"
          >
            {{ MODE_CONFIG[m].label }}
          </button>
        </div>
      </div>

      <!-- 倒计时 + 进度环 -->
      <div class="relative w-72 h-72 sm:w-80 sm:h-80 mx-auto flex items-center justify-center">
        <svg class="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 200 200">
          <!-- 轨道 -->
          <circle
            cx="100" cy="100" r="90" fill="none"
            stroke="currentColor" stroke-width="6"
            class="text-muted-foreground/25"
          />
          <!-- 进度 -->
          <circle
            cx="100" cy="100" r="90" fill="none"
            stroke="currentColor" stroke-width="6" stroke-linecap="round"
            :class="modeConfig.ring"
            :stroke-dasharray="CIRCUMFERENCE"
            :stroke-dashoffset="ringDashOffset"
            style="transition: stroke-dashoffset 0.35s ease-out;"
          />
        </svg>
        <div class="relative z-10 flex flex-col items-center">
          <span class="text-xs uppercase tracking-widest text-muted-foreground mb-2">
            {{ modeConfig.label }}
          </span>
          <div
            class="text-6xl sm:text-7xl font-mono font-bold tabular-nums leading-none"
            :class="modeConfig.text"
          >
            {{ formatTime(remainingSeconds) }}
          </div>
          <Badge v-if="isRunning" variant="secondary" class="mt-3">运行中</Badge>
          <span v-else class="text-xs text-muted-foreground mt-3">已就绪</span>
        </div>
      </div>

      <!-- 长休息提示 -->
      <div v-if="mode === 'focus' && nextIsLongBreak" class="flex justify-center mt-6">
        <Badge variant="outline" :class="modeConfig.text">
          完成本次专注后将进入长休息
        </Badge>
      </div>

      <!-- 控制按钮 -->
      <div class="flex items-center justify-center gap-4 mt-8">
        <Button
          variant="outline"
          class="h-14 w-14 rounded-full"
          :disabled="isAtInitialState"
          @click="resetTimer"
        >
          <RotateCcw class="!w-5 !h-5" />
        </Button>
        <Button
          class="h-14 rounded-full px-10 text-base gap-2.5 shadow-lg transition-colors"
          :class="mainButtonClass"
          @click="toggleTimer"
        >
          <component :is="isRunning ? Pause : Play" class="!w-5 !h-5" />
          {{ isRunning ? '暂停' : '开始' }}
        </Button>
      </div>
    </Card>

    <!-- 页面内提示 -->
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showTip"
        class="fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm"
      >
        <Card class="p-4 shadow-xl relative overflow-hidden">
          <div class="absolute left-0 top-0 bottom-0 w-1" :class="modeConfig.bar" />
          <div class="flex items-start gap-3 pl-1">
            <div
              class="flex items-center justify-center w-9 h-9 rounded-full shrink-0"
              :class="modeConfig.activeBg"
            >
              <component :is="mode === 'focus' ? Timer : Coffee" class="w-4 h-4" />
            </div>
            <p class="text-sm flex-1 pt-1.5">{{ tip }}</p>
            <button
              class="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
              @click="dismissTip"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
        </Card>
      </div>
    </Transition>

    <!-- 设置对话框 -->
    <Dialog :open="showSettings" @update:open="(v) => { if (!v) closeSettings() }">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>番茄计时设置</DialogTitle>
          <DialogDescription>自定义专注与休息时长，设置将保存到本地。</DialogDescription>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <div class="grid grid-cols-2 gap-4">
            <!-- 专注时长 -->
            <div class="space-y-2">
              <Label>专注时长（分钟）</Label>
              <Input
                v-model.number="settingsForm.focusMinutes"
                type="number"
                :min="1"
                :max="90"
              />
              <p class="text-xs text-muted-foreground">范围 1 - 90</p>
            </div>

            <!-- 短休息时长 -->
            <div class="space-y-2">
              <Label>短休息时长（分钟）</Label>
              <Input
                v-model.number="settingsForm.shortBreakMinutes"
                type="number"
                :min="1"
                :max="30"
              />
              <p class="text-xs text-muted-foreground">范围 1 - 30</p>
            </div>

            <!-- 长休息时长 -->
            <div class="space-y-2">
              <Label>长休息时长（分钟）</Label>
              <Input
                v-model.number="settingsForm.longBreakMinutes"
                type="number"
                :min="1"
                :max="60"
              />
              <p class="text-xs text-muted-foreground">范围 1 - 60</p>
            </div>

            <!-- 长休息触发间隔 -->
            <div class="space-y-2">
              <Label>长休息触发间隔（次）</Label>
              <Input
                v-model.number="settingsForm.longBreakInterval"
                type="number"
                :min="2"
                :max="8"
              />
              <p class="text-xs text-muted-foreground">范围 2 - 8</p>
            </div>
          </div>

          <!-- 自动开始下一个模式 -->
          <div class="flex items-center justify-between rounded-lg border border-border p-3">
            <div class="pr-3">
              <Label>自动开始下一个模式</Label>
              <p class="text-xs text-muted-foreground mt-1">专注/休息结束后自动切换并开始</p>
            </div>
            <Switch
              :checked="settingsForm.autoStart"
              @update:checked="(v: boolean) => settingsForm.autoStart = v"
            />
          </div>
        </div>

        <DialogFooter class="gap-2">
          <Button variant="outline" @click="closeSettings">取消</Button>
          <Button @click="saveSettingsForm">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
