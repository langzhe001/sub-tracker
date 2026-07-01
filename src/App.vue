<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores'
import {
  LayoutDashboard,
  CreditCard,
  FolderTree,
  Bell,
  LogOut,
  ScrollText,
  Menu,
  X,
  ListTodo,
  Timer,
  Flame,
  Database
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const isAuthPage = computed(() => {
  return route.name === 'login' || route.name === 'register'
})

const showSidebar = computed(() => authStore.isAuthenticated && !isAuthPage.value)

// 移动端抽屉菜单开关
const mobileMenuOpen = ref(false)

// 路由切换时关闭抽屉
watch(() => route.path, () => {
  mobileMenuOpen.value = false
})

const navItems = [
  { path: '/', name: 'dashboard', icon: LayoutDashboard, label: '仪表盘' },
  { path: '/tasks', name: 'tasks', icon: ListTodo, label: '任务管理' },
  { path: '/habits', name: 'habits', icon: Flame, label: '习惯打卡' },
  { path: '/pomodoro', name: 'pomodoro', icon: Timer, label: '番茄计时' },
  { path: '/subscriptions', name: 'subscriptions', icon: CreditCard, label: '订阅管理' },
  { path: '/groups', name: 'groups', icon: FolderTree, label: '分组管理' },
  { path: '/channels', name: 'channels', icon: Bell, label: '通知渠道' },
  { path: '/notifications', name: 'notifications', icon: ScrollText, label: '通知日志' },
  { path: '/backup', name: 'backup', icon: Database, label: '备份恢复' }
]

async function handleLogout() {
  authStore.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="animate-fade-in min-h-screen bg-background text-foreground">
    <template v-if="showSidebar">
      <!-- 桌面端固定侧边栏 (md 及以上) -->
      <aside class="hidden md:flex fixed left-0 top-0 h-full w-64 flex-col">
        <Card class="h-full w-full rounded-none flex flex-col">
          <div class="p-6 border-b border-border">
            <h1 class="text-xl font-bold bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] bg-clip-text text-transparent">
              SubTracker
            </h1>
            <p class="text-xs text-muted-foreground mt-1">订阅管理助手</p>
          </div>

          <nav class="flex-1 p-3 space-y-1 overflow-y-auto">
            <Button
              v-for="item in navItems"
              :key="item.name"
              as-child
              :variant="route.name === item.name ? 'secondary' : 'ghost'"
              class="w-full justify-start font-normal"
            >
              <router-link :to="item.path">
                <component :is="item.icon" />
                <span>{{ item.label }}</span>
              </router-link>
            </Button>
          </nav>

          <div class="p-3 border-t border-border">
            <Button
              variant="ghost"
              class="w-full justify-start font-normal text-muted-foreground"
              @click="handleLogout"
            >
              <LogOut />
              <span>退出登录</span>
            </Button>
          </div>
        </Card>
      </aside>

      <!-- 移动端顶部栏 (md 以下) -->
      <header class="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <Button variant="ghost" size="icon" class="h-9 w-9" @click="mobileMenuOpen = true">
          <Menu class="w-5 h-5" />
        </Button>
        <h1 class="text-base font-bold bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] bg-clip-text text-transparent">
          SubTracker
        </h1>
        <Button variant="ghost" size="icon" class="h-9 w-9" @click="handleLogout">
          <LogOut class="w-5 h-5" />
        </Button>
      </header>

      <!-- 移动端抽屉遮罩 -->
      <Transition name="fade">
        <div
          v-if="mobileMenuOpen"
          class="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          @click="mobileMenuOpen = false"
        />
      </Transition>

      <!-- 移动端抽屉式侧边栏 -->
      <Transition name="slide-in-left">
        <aside
          v-if="mobileMenuOpen"
          class="md:hidden fixed left-0 top-0 h-full w-72 z-50 flex flex-col"
        >
          <Card class="h-full w-full rounded-none flex flex-col">
            <div class="p-6 border-b border-border flex items-center justify-between">
              <div>
                <h1 class="text-xl font-bold bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] bg-clip-text text-transparent">
                  SubTracker
                </h1>
                <p class="text-xs text-muted-foreground mt-1">订阅管理助手</p>
              </div>
              <Button variant="ghost" size="icon" class="h-8 w-8" @click="mobileMenuOpen = false">
                <X class="w-4 h-4" />
              </Button>
            </div>

            <nav class="flex-1 p-3 space-y-1 overflow-y-auto">
              <Button
                v-for="item in navItems"
                :key="item.name"
                as-child
                :variant="route.name === item.name ? 'secondary' : 'ghost'"
                class="w-full justify-start font-normal h-11"
              >
                <router-link :to="item.path">
                  <component :is="item.icon" />
                  <span>{{ item.label }}</span>
                </router-link>
              </Button>
            </nav>

            <div class="p-3 border-t border-border">
              <Button
                variant="ghost"
                class="w-full justify-start font-normal text-muted-foreground h-11"
                @click="handleLogout"
              >
                <LogOut />
                <span>退出登录</span>
              </Button>
            </div>
          </Card>
        </aside>
      </Transition>

      <!-- 主内容区: 移动端全宽 p-4，桌面端 ml-64 p-8 -->
      <main class="md:ml-64 p-4 md:p-8">
        <router-view />
      </main>
    </template>

    <template v-else>
      <router-view />
    </template>
  </div>
</template>

<style scoped>
/* 抽屉滑入动画 */
.slide-in-left-enter-active,
.slide-in-left-leave-active {
  transition: transform 0.25s ease-out;
}
.slide-in-left-enter-from,
.slide-in-left-leave-to {
  transform: translateX(-100%);
}

/* 遮罩淡入动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease-out;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
