<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useGroupStore } from '@/stores'
import { Plus, Edit2, Trash2, Palette, Folder } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'

const groupStore = useGroupStore()

const showForm = ref(false)
const showDeleteConfirm = ref(false)
const editingGroup = ref<{ id?: string; name: string; color: string } | null>(null)
const deletingId = ref<string | null>(null)

const form = ref({
  name: '',
  color: '#6366F1'
})

const colorOptions = [
  '#6366F1', '#8B5CF6', '#EC4899', '#EF4444',
  '#F59E0B', '#10B981', '#06B6D4', '#3B82F6'
]

onMounted(() => {
  groupStore.fetchGroups()
})

function openCreateForm() {
  editingGroup.value = null
  form.value = { name: '', color: '#6366F1' }
  showForm.value = true
}

function openEditForm(group: typeof editingGroup.value) {
  if (!group) return
  editingGroup.value = { id: group.id, name: group.name, color: group.color }
  form.value = { name: group.name, color: group.color }
  showForm.value = true
}

async function handleSubmit() {
  if (!form.value.name.trim()) return

  if (editingGroup.value?.id) {
    await groupStore.updateGroup(editingGroup.value.id, form.value)
  } else {
    await groupStore.createGroup(form.value)
  }

  showForm.value = false
  editingGroup.value = null
}

function confirmDelete(id: string) {
  deletingId.value = id
  showDeleteConfirm.value = true
}

async function handleDelete() {
  if (deletingId.value) {
    await groupStore.deleteGroup(deletingId.value)
    showDeleteConfirm.value = false
    deletingId.value = null
  }
}
</script>

<template>
  <div class="animate-fade-in">
    <div class="flex items-center justify-between mb-4 md:mb-8">
      <h1 class="text-xl md:text-2xl font-bold">分组管理</h1>
      <Button @click="openCreateForm">
        <Plus class="w-4 h-4" />
        添加分组
      </Button>
    </div>

    <EmptyState
      v-if="groupStore.groups.length === 0"
      :icon="Folder"
      title="暂无分组"
      description="还没有添加任何分组，点击下方按钮创建第一个分组。"
    >
      <Button @click="openCreateForm">
        <Plus class="w-4 h-4" />
        创建第一个分组
      </Button>
    </EmptyState>

    <Card v-else class="divide-y divide-border">
      <div
        v-for="group in groupStore.groups"
        :key="group.id"
        class="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
      >
        <div class="flex items-center gap-4">
          <div
            class="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold"
            :style="{ backgroundColor: group.color + '20', color: group.color }"
          >
            {{ group.icon || group.name.charAt(0) }}
          </div>
          <div>
            <p class="font-medium text-foreground">{{ group.name }}</p>
            <p class="text-sm text-muted-foreground">颜色：{{ group.color }}</p>
          </div>
        </div>

        <div class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            @click="openEditForm(group)"
          >
            <Edit2 class="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8 text-destructive hover:text-destructive"
            @click="confirmDelete(group.id)"
          >
            <Trash2 class="w-4 h-4" />
          </Button>
        </div>
      </div>
    </Card>

    <Dialog v-model:open="showForm">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>{{ editingGroup?.id ? '编辑分组' : '添加分组' }}</DialogTitle>
          <DialogDescription>
            {{ editingGroup?.id ? '修改分组的名称和颜色标识。' : '为订阅创建一个新的分组，便于管理和归类。' }}
          </DialogDescription>
        </DialogHeader>

        <form @submit.prevent="handleSubmit" class="space-y-5">
          <div class="space-y-2">
            <Label for="group-name">分组名称</Label>
            <Input
              id="group-name"
              v-model="form.name"
              type="text"
              placeholder="例如：流媒体"
              required
            />
          </div>

          <div class="space-y-2">
            <Label>颜色</Label>
            <div class="flex flex-wrap gap-3">
              <button
                v-for="color in colorOptions"
                :key="color"
                type="button"
                @click="form.color = color"
                class="w-10 h-10 rounded-lg transition-all flex items-center justify-center ring-offset-background"
                :class="form.color === color ? 'ring-2 ring-ring ring-offset-2' : ''"
                :style="{ backgroundColor: color }"
              >
                <Palette v-if="form.color === color" class="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        </form>

        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showForm = false">取消</Button>
          <Button @click="handleSubmit">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="showDeleteConfirm">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>确认删除</DialogTitle>
          <DialogDescription>
            确定要删除这个分组吗？订阅不会被删除，但会变为无分组状态。
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
