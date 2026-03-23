<script setup lang="ts">
import { useToast, setMaxToasts, type ToastType } from "@/composables/useToast";

const props = withDefaults(defineProps<{ max?: number }>(), { max: 5 });

setMaxToasts(props.max);

const { toasts, remove } = useToast();

const iconStyles: Record<ToastType, string> = {
  default: "text-on-surface-variant",
  loading: "text-on-surface-variant",
  info: "text-blue-500",
  success: "text-green-600",
  warning: "text-amber-500",
  error: "text-red-500",
};
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed bottom-24 inset-x-0 z-100 flex flex-col items-center gap-2 pointer-events-none"
    >
      <TransitionGroup
        enter-active-class="transition-all duration-300 ease-out"
        leave-active-class="transition-all duration-200 ease-in absolute"
        enter-from-class="translate-y-1 opacity-0 scale-95"
        leave-to-class="-translate-y-1 opacity-0 scale-95"
        move-class="transition-all duration-300 ease-out"
      >
        <div
          v-for="item in toasts"
          :key="item.id"
          class="pointer-events-auto border border-outline-variant/30 rounded-lg px-3.5 py-2.5 flex items-center gap-2.5 text-sm bg-surface-bright text-on-surface shadow-lg whitespace-nowrap backdrop-blur-sm"
        >
          <!-- 自定义图标 -->
          <template v-if="item.icon !== false">
            <component :is="item.icon" v-if="item.icon" class="size-4 shrink-0" :class="iconStyles[item.type]" />
            <template v-else>
              <SLoading v-if="item.type === 'loading'" class="size-4 shrink-0" />
              <IconLucideMessageCircle
                v-else-if="item.type === 'default'"
                class="size-4 shrink-0 text-on-surface-variant"
              />
              <IconLucideInfo v-else-if="item.type === 'info'" class="size-4 shrink-0 text-blue-500" />
              <IconLucideCircleCheck v-else-if="item.type === 'success'" class="size-4 shrink-0 text-green-600" />
              <IconLucideTriangleAlert
                v-else-if="item.type === 'warning'"
                class="size-4 shrink-0 text-amber-500"
              />
              <IconLucideCircleX v-else-if="item.type === 'error'" class="size-4 shrink-0 text-red-500" />
            </template>
          </template>
          <span>{{ item.message }}</span>
          <button
            v-if="item.closable"
            class="shrink-0 p-0 border-none bg-transparent opacity-40 hover:opacity-100 cursor-pointer text-current leading-0 transition-opacity duration-200"
            @click="remove(item.id)"
          >
            <IconLucideX class="size-3.5" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
