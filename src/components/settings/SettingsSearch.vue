<script setup lang="ts">
import { settingsSchema } from "@/settings/schema";

const emit = defineEmits<{
  select: [categoryId: string, itemKey: string];
  "active-change": [active: boolean];
}>();

const { t } = useI18n();
const query = ref("");
const isFocused = ref(false);

const isSearchActive = computed(() => isFocused.value && query.value.length > 0);

watch(isSearchActive, (v) => emit("active-change", v));

interface SearchResult {
  categoryId: string;
  itemKey: string;
  label: string;
  description: string;
  categoryLabel: string;
}

const results = computed<SearchResult[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [];
  const out: SearchResult[] = [];
  for (const cat of settingsSchema) {
    for (const sec of cat.sections ?? []) {
      if (sec.visible && !sec.visible()) continue;
      for (const item of sec.items) {
        if (item.visible && !item.visible()) continue;
        if (item.searchable === false) continue;
        const label = t(`settings.${item.key}.label`);
        const desc = item.hideDescription ? "" : t(`settings.${item.key}.description`);
        const kw = item.keywords?.map((k) => t(k)).join(" ") ?? "";
        if (`${label} ${desc} ${kw}`.toLowerCase().includes(q)) {
          out.push({
            categoryId: cat.id,
            itemKey: item.key,
            label,
            description: desc,
            categoryLabel: t(`settings.group.${cat.id}`),
          });
        }
      }
    }
  }
  return out;
});

const handleSelect = (r: SearchResult) => {
  emit("select", r.categoryId, r.itemKey);
  query.value = "";
};

const handleBlur = () => {
  setTimeout(() => (isFocused.value = false), 150);
};
</script>

<template>
  <div class="relative">
    <SInput
      v-model="query"
      :placeholder="t('settings.search')"
      clearable
      @focus="isFocused = true"
      @blur="handleBlur"
    >
      <template #prefix>
        <IconLucideSearch class="size-3.5 text-on-surface-variant/50" />
      </template>
    </SInput>

    <!-- 搜索结果 -->
    <Transition
      enter-active-class="transition-[opacity,transform] duration-200 ease-out"
      leave-active-class="transition-[opacity,transform] duration-150 ease-in"
      enter-from-class="opacity-0 -translate-y-1"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div
        v-if="isSearchActive"
        class="absolute left-0 right-0 top-full mt-2 max-h-[calc(75vh-220px)] overflow-y-auto rounded-lg border border-solid border-outline-variant/80 z-10 p-1"
      >
        <template v-if="results.length > 0">
          <div
            v-for="r in results"
            :key="`${r.categoryId}-${r.itemKey}`"
            class="flex flex-col px-3 py-2 rounded-lg cursor-pointer transition-[background-color] duration-200 hover:bg-on-surface/8"
            @mousedown.prevent="handleSelect(r)"
          >
            <span class="text-xs text-on-surface-variant/40">{{ r.categoryLabel }}</span>
            <span class="text-sm font-medium">{{ r.label }}</span>
            <span v-if="r.description" class="text-xs text-on-surface-variant/50 truncate">
              {{ r.description }}
            </span>
          </div>
        </template>
        <div v-else class="px-3 py-4 text-sm text-on-surface-variant/50 text-center">
          {{ t("common.noData") }}
        </div>
      </div>
    </Transition>
  </div>
</template>
