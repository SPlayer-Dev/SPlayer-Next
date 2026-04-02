<script setup lang="ts">
export interface SDialogProps {
  /** 控制打开状态（v-model:open） */
  open?: boolean;
  /** 是否为模态（阻止外部交互） */
  modal?: boolean;
  /** 标题（无障碍必需，不传则隐藏标题区） */
  title?: string;
  /** 描述文本 */
  description?: string;
  /** 是否显示关闭按钮 */
  closable?: boolean;
  /** 封面主题模式（播放器内使用） */
  cover?: boolean;
  /** 宽度，支持 CSS 值（默认 460px） */
  width?: string;
  /** 高度，支持 CSS 值（默认 auto，受 max-h 限制） */
  height?: string;
}

const props = withDefaults(defineProps<SDialogProps>(), {
  modal: true,
  closable: true,
  cover: false,
  width: "460px",
  height: "auto",
});

const contentStyle = computed(() => ({
  width: props.width,
  height: props.height === "auto" ? undefined : props.height,
  maxHeight: props.height === "auto" ? "85vh" : undefined,
}));

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const isOpen = ref(props.open ?? false);

watch(
  () => props.open,
  (val) => {
    if (val !== undefined) isOpen.value = val;
  },
);

const setOpen = (val: boolean): void => {
  isOpen.value = val;
  emit("update:open", val);
};
</script>

<template>
  <DialogRoot :open="isOpen" :modal="modal" @update:open="setOpen">
    <!-- 触发器插槽 -->
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal>
      <!-- 遮罩层 -->
      <DialogOverlay
        :class="[
          'fixed inset-0 z-300 data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
          cover ? 'bg-black/50' : 'bg-black/40',
        ]"
      />

      <!-- 内容面板 -->
      <DialogContent
        :style="contentStyle"
        :class="[
          'fixed top-1/2 left-1/2 z-300 -translate-x-1/2 -translate-y-1/2',
          'rounded-xl shadow-xl overflow-hidden',
          'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
          'focus:outline-none',
          height === 'auto' ? 'overflow-y-auto px-5 py-4' : 'flex flex-col',
          cover
            ? 'bg-black/55 backdrop-blur-xl backdrop-saturate-160 border border-solid border-white/10 text-cover'
            : 'bg-surface-bright border border-solid border-outline-variant/30 text-on-surface',
        ]"
      >
        <!-- 标题 + 描述 -->
        <div v-if="title" class="mb-3 pr-6">
          <DialogTitle class="text-lg font-semibold">
            {{ title }}
          </DialogTitle>
          <DialogDescription
            v-if="description"
            :class="['text-xs mt-1', cover ? 'text-cover/50' : 'text-on-surface/50']"
          >
            {{ description }}
          </DialogDescription>
        </div>
        <!-- 无障碍 -->
        <template v-else>
          <DialogTitle class="sr-only">Dialog</DialogTitle>
          <DialogDescription class="sr-only" />
        </template>
        <!-- 内容 -->
        <div :class="[height === 'auto' ? 'text-sm' : 'flex-1 min-h-0 text-sm']">
          <slot />
        </div>
        <!-- 底部操作 -->
        <div v-if="$slots.footer" class="mt-3 flex items-center justify-end gap-2">
          <slot name="footer" :close="() => setOpen(false)" />
        </div>
        <!-- 关闭按钮 -->
        <DialogClose v-if="closable" as-child>
          <SButton
            :type="cover ? 'cover' : 'default'"
            variant="ghost"
            size="small"
            circle
            class="absolute top-3 right-3"
          >
            <template #icon>
              <IconLucideX />
            </template>
          </SButton>
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
