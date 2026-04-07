<script setup lang="ts">
import { settingsSchema } from "@/settings/schema";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { useSettingsStore } from "@/stores/settings";

const { initialCategory, initialHighlight } = useSettingsDialog();

// 打开设置时从主进程同步后端配置
useSettingsStore().syncSystem();
const { t } = useI18n();

const activeId = ref(initialCategory.value);
const highlightKey = ref(initialHighlight.value);
const scrollRef = ref<HTMLElement>();
const isSearchActive = ref(false);

const activeCategory = computed(() => settingsSchema.find((c) => c.id === activeId.value));

/** 计算每个 section 的全局起始索引（标题 + items 累加） */
const sectionStartIndices = computed(() => {
  const indices: number[] = [];
  let idx = 0;
  for (const sec of activeCategory.value?.sections ?? []) {
    indices.push(idx);
    idx += 1 + sec.items.length;
  }
  return indices;
});

const onCategorySelect = (id: string) => {
  activeId.value = id;
  highlightKey.value = undefined;
  nextTick(() => scrollRef.value?.scrollTo({ top: 0 }));
};

const onSearchSelect = (categoryId: string, itemKey: string) => {
  highlightKey.value = itemKey;
  if (activeId.value !== categoryId) {
    activeId.value = categoryId;
  }
  nextTick(() => {
    setTimeout(() => {
      const el = document.getElementById(`setting-${itemKey}`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => {
        highlightKey.value = undefined;
      }, 2500);
    }, 100);
  });
};

onMounted(() => {
  if (initialHighlight.value) {
    onSearchSelect(initialCategory.value, initialHighlight.value);
  }
});
</script>

<template>
  <div class="flex h-full overflow-hidden">
    <!-- 左侧 -->
    <div class="w-70 shrink-0 flex flex-col bg-surface-panel p-5">
      <h2 class="text-lg font-bold mb-0.5 px-1">{{ t("settings.title") }}</h2>
      <p class="text-xs text-on-surface-variant/50 mb-5 px-1">SPlayer</p>

      <!-- 搜索 -->
      <SettingsSearch class="mb-4" @select="onSearchSelect" @active-change="isSearchActive = $event" />

      <!-- 菜单 -->
      <Transition name="fade">
        <div v-show="!isSearchActive" class="flex-1 min-h-0 overflow-y-auto">
          <SettingsMenu
            :categories="settingsSchema"
            :active-id="activeId"
            @select="onCategorySelect"
          />
        </div>
      </Transition>
    </div>

    <!-- 右侧 -->
    <div ref="scrollRef" class="flex-1 overflow-y-auto bg-surface py-6 px-8">
      <div v-if="activeCategory" :key="activeCategory.id" class="animate-fade-in">
        <SettingsSection
          v-for="(sec, si) in activeCategory.sections"
          :key="sec.id"
          :section="sec"
          :highlight-key="highlightKey"
          :start-index="sectionStartIndices[si] ?? 0"
        />
      </div>
    </div>
  </div>
</template>
