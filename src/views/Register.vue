<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores'
import { Mail, Lock, Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const router = useRouter()
const authStore = useAuthStore()

const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')

async function handleSubmit() {
  error.value = ''

  if (password.value !== confirmPassword.value) {
    error.value = '两次密码输入不一致'
    return
  }

  if (password.value.length < 6) {
    error.value = '密码长度至少6位'
    return
  }

  loading.value = true

  try {
    const result = await authStore.register(email.value, password.value)
    if (result.success) {
      router.push({ name: 'dashboard' })
    } else {
      error.value = result.error || '注册失败，请重试'
    }
  } catch (e) {
    error.value = '注册失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="animate-fade-in min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background">
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px]"></div>
      <div class="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#8B5CF6]/20 rounded-full blur-[128px]"></div>
    </div>

    <div class="relative w-full max-w-md">
      <div class="text-center mb-8">
        <h1 class="text-4xl font-bold bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] bg-clip-text text-transparent mb-2">
          SubTracker
        </h1>
        <p class="text-muted-foreground">订阅管理助手</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>注册账户</CardTitle>
          <CardDescription>创建一个新账户开始管理您的订阅</CardDescription>
        </CardHeader>

        <CardContent>
          <form @submit.prevent="handleSubmit" class="space-y-4">
            <div class="space-y-2">
              <Label for="email">邮箱</Label>
              <div class="relative">
                <Mail class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="email"
                  v-model="email"
                  type="email"
                  placeholder="your@email.com"
                  class="pl-9"
                  required
                />
              </div>
            </div>

            <div class="space-y-2">
              <Label for="password">密码</Label>
              <div class="relative">
                <Lock class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="password"
                  v-model="password"
                  type="password"
                  placeholder="••••••••"
                  class="pl-9"
                  required
                />
              </div>
            </div>

            <div class="space-y-2">
              <Label for="confirmPassword">确认密码</Label>
              <div class="relative">
                <Lock class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="confirmPassword"
                  v-model="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  class="pl-9"
                  required
                />
              </div>
            </div>

            <div v-if="error" class="text-destructive text-sm">
              {{ error }}
            </div>

            <Button type="submit" class="w-full" :disabled="loading">
              <Loader2 v-if="loading" class="animate-spin" />
              <span>{{ loading ? '注册中...' : '注册' }}</span>
            </Button>
          </form>
        </CardContent>

        <CardFooter class="justify-center">
          <p class="text-sm text-muted-foreground">
            已有账户？
            <router-link to="/login" class="text-primary hover:underline">
              登录
            </router-link>
          </p>
        </CardFooter>
      </Card>
    </div>
  </div>
</template>
