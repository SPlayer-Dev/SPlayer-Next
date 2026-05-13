<script setup lang="ts">
const { t } = useI18n();
const router = useRouter();

const dialogOpen = ref(false);
const searchQuery = ref("");

const trimmedQuery = computed(() => searchQuery.value.trim());

/** 提交搜索：跳到搜索结果页并关闭弹窗 */
const onSubmit = (): void => {
  if (!trimmedQuery.value) return;
  router.push({ name: "search", query: { q: trimmedQuery.value } });
  dialogOpen.value = false;
};
</script>

<template>
  <!-- 触发器：只读 SInput，点击打开弹窗 -->
  <SInput
    readonly
    round
    size="large"
    class="app-no-drag w-60 cursor-pointer"
    :placeholder="t('nav.searchPlaceholder')"
    @click="dialogOpen = true"
  >
    <template #prefix>
      <IconLucideSearch class="size-4 text-on-surface-variant/50 shrink-0" />
    </template>
  </SInput>

  <!-- 搜索弹窗 -->
  <SDialog v-model:open="dialogOpen" :closable="false" width="560px">
    <div class="flex flex-col gap-3">
      <SInput
        v-model="searchQuery"
        :placeholder="t('nav.searchPlaceholder')"
        size="large"
        clearable
        @keydown.enter="onSubmit"
      >
        <template #prefix>
          <IconLucideSearch class="size-4 text-on-surface-variant/50 shrink-0" />
        </template>
      </SInput>
      <!-- 快捷操作区 -->
      <div v-if="trimmedQuery" class="flex flex-col gap-1.5">
        <div class="px-2 text-xs text-on-surface-variant/60">
          {{ t("nav.searchSection.quick") }}
        </div>
        <button
          type="button"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-left bg-transparent border-none hover:bg-on-surface/5 transition-colors duration-200"
          @click="onSubmit"
        >
          <IconLucideSearch class="size-4 text-on-surface-variant/60 shrink-0" />
          <span class="flex-1 truncate text-sm text-on-surface">
            {{ t("nav.searchGoto", { keyword: trimmedQuery }) }}
          </span>
          <IconLucideArrowRight class="size-4 text-on-surface-variant/40 shrink-0" />
        </button>
      </div>
      <!-- 空态：后续接入搜索历史、热门等 -->
      <div
        v-else
        class="min-h-[200px] flex flex-col items-center justify-center gap-2 text-on-surface-variant/40"
      >
        <IconLucideSearch class="size-8" />
        <span class="text-xs">{{ t("nav.searchEmpty") }}</span>
      </div>
    </div>
  </SDialog>
</template>
