<script setup lang="ts">
import { settingsSchema } from "@/settings/schema";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { useSettingsStore } from "@/stores/settings";
import { openExternal } from "@/utils/url";
import { REPO_URL, REPO_NAME, APP_VERSION } from "@/utils/config";

const { initialCategory, initialHighlight, rememberCategory } = useSettingsDialog();

// 同步后端配置
useSettingsStore().syncSystem();
const { t } = useI18n();

const activeId = ref(initialCategory.value);
const highlightKey = ref(initialHighlight.value);
const scrollRef = ref<HTMLElement>();
const isSearchActive = ref(false);

const activeCategory = computed(() => settingsSchema.find((c) => c.id === activeId.value));

/** 计算每个 section 的全局起始索引 */
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
  rememberCategory(id);
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
      <h2 class="text-2xl font-bold mb-1 px-1">{{ t("settings.title") }}</h2>
      <p class="text-sm text-on-surface-variant/80 mb-5 px-1">{{ t("settings.subtitle") }}</p>

      <!-- 搜索 -->
      <SettingsSearch
        class="mb-4"
        @select="onSearchSelect"
        @active-change="isSearchActive = $event"
      />

      <!-- 菜单 -->
      <Transition name="fade">
        <div v-show="!isSearchActive" class="flex-1 min-h-0 overflow-y-auto -mr-5 pr-5">
          <SettingsMenu
            :categories="settingsSchema"
            :active-id="activeId"
            @select="onCategorySelect"
          />
        </div>
      </Transition>

      <!-- 底部 -->
      <div class="shrink-0 mt-auto pt-4 px-1 flex items-center gap-1">
        <SButton variant="text" size="tiny" @click="openExternal(REPO_URL)">
          <template #icon><IconLucideGithub /></template>
          {{ REPO_NAME }}
        </SButton>
        <STag size="tiny">v{{ APP_VERSION }}</STag>
      </div>
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
