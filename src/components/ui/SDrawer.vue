<script setup lang="ts">
import { usePopupZIndex } from "@/composables/useZIndex";

export interface SDrawerProps {
  /** 控制打开状态（v-model:open） */
  open?: boolean;
  /** 是否为模态（显示遮罩、阻止外部交互） */
  modal?: boolean;
  /** 抽屉方向 */
  side?: "left" | "right";
  /** 抽屉宽度，支持 CSS 值 */
  width?: string;
  /** 标题（无障碍必需，不传则视觉隐藏） */
  title?: string;
  /** 描述文本 */
  description?: string;
  /** 是否显示关闭按钮 */
  closable?: boolean;
  /** 封面主题模式 */
  cover?: boolean;
}

const props = withDefaults(defineProps<SDrawerProps>(), {
  modal: true,
  side: "right",
  width: "320px",
  closable: true,
  cover: false,
});

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { zIndex, onOpenChange } = usePopupZIndex();

const isOpen = ref(props.open ?? false);

watch(
  () => props.open,
  (val) => {
    if (val !== undefined) isOpen.value = val;
  },
);

watch(isOpen, onOpenChange, { immediate: true });

const setOpen = (val: boolean): void => {
  isOpen.value = val;
  emit("update:open", val);
};

const contentClass = computed(() => {
  const base = [
    "fixed top-0 bottom-0 flex flex-col focus:outline-none",
    props.cover
      ? "bg-transparent text-cover shadow-none"
      : "bg-surface-bright text-on-surface shadow-xl",
  ];

  if (props.side === "left") {
    base.push(
      "left-0 rounded-r-3",
      "data-[state=open]:animate-drawer-in-left data-[state=closed]:animate-drawer-out-left",
    );
  } else {
    base.push(
      "right-0 rounded-l-3",
      "data-[state=open]:animate-drawer-in-right data-[state=closed]:animate-drawer-out-right",
    );
  }

  return base;
});
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
        v-if="modal"
        :style="{ zIndex }"
        :class="[
          'fixed inset-0',
          'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
          cover ? 'bg-black/30 backdrop-blur-xl' : 'bg-black/40',
        ]"
      />

      <!-- 抽屉面板 -->
      <DialogContent :class="contentClass" :style="{ width, zIndex }">
        <!-- 无障碍标题（始终存在，视觉隐藏） -->
        <DialogTitle class="sr-only">{{ title ?? "抽屉" }}</DialogTitle>
        <DialogDescription class="sr-only">{{ description ?? "" }}</DialogDescription>

        <!-- 头部 -->
        <div v-if="$slots.header || title || closable" class="flex items-center shrink-0 px-4 py-3">
          <div class="flex-1 min-w-0">
            <slot name="header">
              <span v-if="title" class="text-sm font-semibold truncate">{{ title }}</span>
            </slot>
          </div>
          <DialogClose v-if="closable" as-child>
            <SButton
              :type="cover ? 'cover' : 'default'"
              variant="ghost"
              size="small"
              circle
              class="ml-auto shrink-0"
            >
              <template #icon>
                <IconLucideX />
              </template>
            </SButton>
          </DialogClose>
        </div>

        <!-- 内容 -->
        <div class="flex-1 overflow-y-auto">
          <slot />
        </div>

        <!-- 底部操作 -->
        <div v-if="$slots.footer" class="shrink-0 px-4 py-3 flex items-center justify-end gap-2">
          <slot name="footer" :close="() => setOpen(false)" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
