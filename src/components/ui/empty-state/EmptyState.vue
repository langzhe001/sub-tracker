<script setup lang="ts">
import type { Component, HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  icon?: Component
  title?: string
  description?: string
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <div
    :class="
      cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center',
        props.class,
      )
    "
  >
    <div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
      <slot name="icon">
        <component :is="props.icon" v-if="props.icon" class="h-6 w-6 text-muted-foreground" />
      </slot>
    </div>

    <slot name="title">
      <h3
        v-if="props.title"
        class="mt-4 text-lg font-semibold"
      >
        {{ props.title }}
      </h3>
    </slot>

    <slot name="description">
      <p
        v-if="props.description"
        class="mt-2 text-sm text-muted-foreground"
      >
        {{ props.description }}
      </p>
    </slot>

    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>
  </div>
</template>
