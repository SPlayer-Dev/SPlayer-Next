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
}

const props = withDefaults(defineProps<SDialogProps>(), {
  modal: true,
  closable: true,
  cover: false,
});

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
    <!-- 触发器插槽（可选，也可纯用 v-model:open 控制） -->
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
        :class="[
          'fixed top-1/2 left-1/2 z-300 max-h-[85vh] w-[90vw] max-w-lg -translate-x-1/2 -translate-y-1/2',
          'rounded-xl shadow-xl px-5 py-4 overflow-y-auto',
          'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
          'focus:outline-none',
          cover
            ? 'bg-black/55 backdrop-blur-xl backdrop-saturate-160 border-1 border-solid border-white/10 text-cover'
            : 'bg-surface-bright border-1 border-solid border-outline-variant/30 text-on-surface',
        ]"
      >
        <!-- 标题 -->
        <DialogTitle v-if="title" class="text-base font-semibold mb-0.5 pr-6">
          {{ title }}
        </DialogTitle>
        <!-- 无标题时仍需保留无障碍标题（视觉隐藏） -->
        <DialogTitle v-else class="sr-only">对话框</DialogTitle>

        <!-- 描述 -->
        <DialogDescription
          v-if="description"
          :class="['text-xs mb-3', cover ? 'text-cover/50' : 'text-on-surface/50']"
        >
          {{ description }}
        </DialogDescription>

        <!-- 内容 -->
        <slot />

        <!-- 底部操作区 -->
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
