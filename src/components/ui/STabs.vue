<script setup lang="ts">
export interface TabItem {
  /** 唯一标识 */
  key: string;
  /** 显示文本（默认取 key） */
  label?: string;
  /** 禁用 */
  disabled?: boolean;
}

export interface STabsProps {
  /** 当前激活的 tab key */
  modelValue: string;
  /** tab 列表 */
  tabs: TabItem[];
  /** 样式类型 */
  type?: "bar" | "line" | "segment";
  /** 尺寸 */
  size?: "small" | "medium" | "large";
  /** 主轴排列方式 */
  justifyContent?:
    "space-between" | "space-around" | "space-evenly" | "flex-start" | "center" | "flex-end";
  /** 是否启用动画 */
  animated?: boolean;
  /** 圆角胶囊 */
  round?: boolean;
}

const props = withDefaults(defineProps<STabsProps>(), {
  type: "bar",
  size: "medium",
  animated: false,
  round: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const slots = useSlots();

/** tabs 头部容器 */
const containerRef = shallowRef<HTMLElement | null>(null);
/** 面板外层容器（用于高度过渡） */
const tabsPaneWrapperRef = shallowRef<HTMLElement | null>(null);
/** 高亮条样式（left/width） */
const indicatorStyle = ref<Record<string, string>>({});
/** 面板高度（animated=true 时参与过渡） */
const panelHeight = ref<string>("auto");
/** 切换方向：next（向后）/ prev（向前） */
const panelDirection = ref<"next" | "prev">("next");
/** tab key -> tab 头部节点映射 */
const tabRefs = shallowRef<Record<string, HTMLElement | null>>({});
/** 高度动画的起始值（离场面板高度） */
let fromHeight = 0;

/** 记录每个 tab 头部节点 */
const setTabRef = (key: string, el: unknown): void => {
  tabRefs.value[key] = el instanceof HTMLElement ? el : null;
};

/** 当前是否有面板内容 */
const hasContent = computed(() => !!slots[props.modelValue]);

/** 同步高亮条：用 offset* 对齐 absolute 的 padding-box 基准，避免 border / padding 推算误差 */
const updateIndicator = (): void => {
  if (!containerRef.value) return;
  const active = tabRefs.value[props.modelValue];
  if (!active) {
    indicatorStyle.value = {};
    return;
  }
  if (props.type === "bar") {
    const barWidth = 24;
    const center = active.offsetLeft + active.offsetWidth / 2;
    indicatorStyle.value = {
      left: `${center - barWidth / 2}px`,
      width: `${barWidth}px`,
    };
  } else if (props.type === "segment") {
    // 整盒覆盖当前 tab，上下/左右间距由 container 的 padding 自动决定，绝对对称
    indicatorStyle.value = {
      left: `${active.offsetLeft}px`,
      top: `${active.offsetTop}px`,
      width: `${active.offsetWidth}px`,
      height: `${active.offsetHeight}px`,
    };
  } else {
    indicatorStyle.value = {
      left: `${active.offsetLeft}px`,
      width: `${active.offsetWidth}px`,
    };
  }
};

/** 面板离场前：锁定当前高度，作为过渡起点 */
const onPanelBeforeLeave = (el: Element): void => {
  if (!props.animated) return;
  fromHeight = (el as HTMLElement).getBoundingClientRect().height;
  panelHeight.value = `${fromHeight}px`;
};

/** 面板进场时：写入目标高度，交给 CSS transition 过渡 */
const onPanelEnter = (el: Element): void => {
  if (!props.animated) return;
  const to = (el as HTMLElement).getBoundingClientRect().height;
  if (Math.abs(fromHeight - to) < 1) {
    panelHeight.value = "auto";
    return;
  }
  void tabsPaneWrapperRef.value?.offsetHeight;
  panelHeight.value = `${to}px`;
};

/** 面板进场结束后：恢复高度自适应 */
const onPanelAfterEnter = (): void => {
  if (!props.animated) return;
  panelHeight.value = "auto";
};

/** 点击 tab 切换激活项 */
const select = (tab: TabItem): void => {
  if (tab.disabled || tab.key === props.modelValue) return;
  emit("update:modelValue", tab.key);
};

watch(
  () => props.tabs,
  (value) => {
    if (!value.length) return;
    if (!value.some((tab) => tab.key === props.modelValue)) {
      const fallback = value.find((tab) => !tab.disabled) ?? value[0];
      if (fallback && fallback.key !== props.modelValue) {
        emit("update:modelValue", fallback.key);
      }
    }
    nextTick(updateIndicator);
  },
  { immediate: true },
);

watch(
  () => props.modelValue,
  (newValue, oldValue) => {
    const oldIndex = props.tabs.findIndex((tab) => tab.key === oldValue);
    const newIndex = props.tabs.findIndex((tab) => tab.key === newValue);
    if (oldIndex >= 0 && newIndex >= 0) {
      panelDirection.value = newIndex >= oldIndex ? "next" : "prev";
    }
    nextTick(updateIndicator);
  },
);

onMounted(() => {
  nextTick(updateIndicator);
  if (containerRef.value) {
    useResizeObserver(containerRef, () => nextTick(updateIndicator));
  }
});

/** 尺寸到样式 class 的映射（line / bar 用：tab 自带高度） */
const sizeClasses: Record<string, string> = {
  small: "text-xs h-7 px-2.5",
  medium: "text-sm h-8 px-3",
  large: "text-base h-10 px-3.5",
};

/** segment 外框总高度，与 SButton / SInput 同套：h-8/h-9/h-10 */
const segmentOuterHeight: Record<string, string> = {
  small: "h-8",
  medium: "h-9",
  large: "h-10",
};

/** segment 模式 tab 仅控制字号与水平 padding，高度交给外框 */
const segmentTabClasses: Record<string, string> = {
  small: "text-xs px-2.5",
  medium: "text-sm px-3",
  large: "text-base px-3.5",
};

/** 根据切换方向生成过渡 class */
const panelTransitionClasses = computed(() => {
  const active = "transition-[transform,opacity] duration-240 ease-[cubic-bezier(0.4,0,0.2,1)]";
  if (panelDirection.value === "next") {
    return {
      enterActive: active,
      leaveActive: `${active} absolute top-0 left-0 right-0`,
      enterFrom: "translate-x-4 opacity-0",
      leaveTo: "-translate-x-4 opacity-0",
    };
  }
  return {
    enterActive: active,
    leaveActive: `${active} absolute top-0 left-0 right-0`,
    enterFrom: "-translate-x-4 opacity-0",
    leaveTo: "translate-x-4 opacity-0",
  };
});
</script>

<template>
  <div
    ref="containerRef"
    role="tablist"
    class="relative items-center select-none"
    :style="(type === 'line' || type === 'bar') && justifyContent ? { justifyContent } : undefined"
    :class="[
      type === 'segment' && [
        'flex w-full gap-1 p-0.5 bg-on-surface/3 border border-solid border-on-surface/15',
        segmentOuterHeight[size],
        round ? 'rounded-full' : 'rounded-lg',
      ],
      type === 'line' &&
        (justifyContent ? 'flex w-full pb-1' : 'flex w-full justify-start gap-3 pb-1'),
      type === 'bar' && (justifyContent ? 'flex w-full pb-1' : 'inline-flex shrink-0 gap-3 pb-1'),
    ]"
  >
    <div v-if="type === 'line'" class="absolute inset-x-0 bottom-0 h-0.5 bg-outline-variant/65" />

    <div
      v-if="indicatorStyle.width"
      :class="[
        'absolute pointer-events-none transition-[left,width] duration-320 ease-[cubic-bezier(0.4,0,0.2,1)]',
        type === 'segment'
          ? ['bg-primary/12', round ? 'rounded-full' : 'rounded-md']
          : 'bottom-0.5 h-[3px] bg-primary rounded-full',
      ]"
      :style="indicatorStyle"
    />

    <div
      v-for="tab in tabs"
      :key="tab.key"
      :ref="(el) => setTabRef(tab.key, el)"
      role="tab"
      :aria-selected="modelValue === tab.key"
      :aria-disabled="tab.disabled ? 'true' : 'false'"
      class="relative z-1 inline-flex items-center justify-center whitespace-nowrap outline-none transition-colors duration-200"
      :class="[
        type === 'segment' ? ['flex-1 h-full', segmentTabClasses[size]] : sizeClasses[size],
        tab.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
        modelValue === tab.key
          ? {
              bar: 'text-primary font-medium',
              line: 'text-primary font-medium',
              segment: 'text-on-surface font-medium',
            }[type]
          : {
              bar: 'text-on-surface-variant',
              line: 'text-on-surface-variant',
              segment: 'text-on-surface',
            }[type],
      ]"
      @click="select(tab)"
    >
      <span>{{ tab.label ?? tab.key }}</span>
    </div>
  </div>

  <div
    v-if="hasContent"
    ref="tabsPaneWrapperRef"
    :style="
      animated
        ? {
            height: panelHeight,
            transition: 'height 240ms cubic-bezier(0.4, 0, 0.2, 1)',
          }
        : undefined
    "
    :class="animated ? 'relative overflow-hidden' : ''"
  >
    <Transition
      :css="animated"
      :enter-active-class="panelTransitionClasses.enterActive"
      :leave-active-class="panelTransitionClasses.leaveActive"
      :enter-from-class="panelTransitionClasses.enterFrom"
      :leave-to-class="panelTransitionClasses.leaveTo"
      @before-leave="onPanelBeforeLeave"
      @enter="onPanelEnter"
      @after-enter="onPanelAfterEnter"
    >
      <div :key="modelValue">
        <slot :name="modelValue" />
      </div>
    </Transition>
  </div>
</template>
