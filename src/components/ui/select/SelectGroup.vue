<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { SelectGroup, type SelectGroupProps } from 'radix-vue'

const props = defineProps<SelectGroupProps & { class?: HTMLAttributes['class'] }>()
</script>

<template>
  <SelectGroup :class="cn('p-1', props.class)" v-bind="$attrs">
    <slot />
  </SelectGroup>
</template>
