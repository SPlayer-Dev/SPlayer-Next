<script setup lang="ts">
import { useDataStore } from "@/stores/data";
import { useStatusStore } from "@/stores/status";
import { parseMusicLink } from "@/utils/link";
import { dialog } from "@/composables/useDialog";
import { useSearchCommands, type SearchCommandSection } from "@/composables/useSearchCommands";
import { useSearchResults } from "@/composables/useSearchResults";
import IconLucideZap from "~icons/lucide/zap";
import IconLucideCommand from "~icons/lucide/command";
import IconLucideSearch from "~icons/lucide/search";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const data = useDataStore();
const status = useStatusStore();

/** 弹窗开关挂在 status store，便于快捷键打开 */
const dialogOpen = computed({
  get: () => status.searchOpen,
  set: (value: boolean) => (status.searchOpen = value),
});
const close = (): void => {
  dialogOpen.value = false;
};
const searchQuery = ref("");
const recognitionOpen = ref(false);

const trimmedQuery = computed(() => searchQuery.value.trim());

/** 以「/」开头进入命令模式 */
const isCommand = computed(() => trimmedQuery.value.startsWith("/"));
const commandKeyword = computed(() => trimmedQuery.value.slice(1).trim().toLowerCase());
const { sections: commandSections } = useSearchCommands(commandKeyword, isCommand, close);
const { resultSections, playedSections, loadPlayedTracks, openResource } = useSearchResults(
  trimmedQuery,
  close,
);

/** 音乐链接检测 */
const parsedLink = computed(() => parseMusicLink(trimmedQuery.value));

/**
 * 提交关键词并保留当前搜索来源
 * @param raw - 输入的搜索关键词
 */
const submit = (raw: string): void => {
  const word = raw.trim();
  if (!word) return;
  data.addSearchHistory(word);
  router.push({
    name: "search",
    query: {
      q: word,
      ...(route.name === "search"
        ? {
            platform: route.query.platform,
            plugin: route.query.plugin,
            source: route.query.source,
          }
        : {}),
    },
  });
  close();
};

const onSubmit = (): void => submit(trimmedQuery.value);

/** 二次确认后清空搜索历史 */
const onClearHistory = async (): Promise<void> => {
  const ok = await dialog.confirm({
    title: t("nav.searchSection.history"),
    content: t("nav.searchHistoryClearConfirm"),
    type: "warning",
  });
  if (ok) data.clearSearchHistory();
};

/** 快捷跳转：识别到的音乐链接与搜索当前关键词 */
const quickSection = computed<SearchCommandSection>(() => {
  const link = parsedLink.value;
  return {
    kind: "quick",
    icon: IconLucideZap,
    label: t("nav.searchSection.quick"),
    items: [
      ...(link
        ? [
            {
              id: "parsed-link",
              label: t(`nav.link.${link.type}`, { id: link.id }),
              arrow: true,
              action: () => openResource(link.type, link.id, link.source),
            },
          ]
        : []),
      {
        id: "quick",
        label: t("nav.searchGoto", { keyword: trimmedQuery.value }),
        arrow: true,
        action: onSubmit,
      },
    ],
  };
});

/** 列表分组：命令模式为命令，有输入为快捷跳转与搜索结果，否则为播放记录 */
const listSections = computed<SearchCommandSection[]>(() => {
  if (isCommand.value) return commandSections.value;
  if (trimmedQuery.value) return [quickSection.value, ...resultSections.value];
  return playedSections.value;
});

/** 占位：命令模式无结果，或默认视图没有播放记录时展示 */
const placeholder = computed(() => {
  if (isCommand.value) {
    if (commandSections.value.length > 0) return null;
    return {
      icon: IconLucideCommand,
      text: commandKeyword.value ? t("common.noData") : t("nav.searchCommandTip"),
    };
  }
  if (trimmedQuery.value || playedSections.value.length > 0) return null;
  return { icon: IconLucideSearch, text: t("nav.searchCommandHint") };
});

/** 底部按键提示 */
const footerHints = computed(() => [
  { keys: "↑↓", label: t("nav.searchFooter.select") },
  { keys: "↵", label: t("nav.searchFooter.run") },
  ...(isCommand.value ? [] : [{ keys: "/", label: t("nav.searchFooter.command") }]),
  { keys: "Esc", label: isCommand.value ? t("common.back") : t("common.close") },
]);

const bodyRef = ref<HTMLElement | null>(null);
const bodyHeight = ref<number | null>(null);

useResizeObserver(bodyRef, (entries) => {
  if (bodyHeight.value === null) return;
  const next = entries[0]?.borderBoxSize?.[0]?.blockSize;
  if (next != null) bodyHeight.value = next;
});

const bodyStyle = computed(() =>
  bodyHeight.value !== null ? { height: `${bodyHeight.value}px` } : undefined,
);

const activeIndex = ref(-1);

/** 键盘上下导航：默认视图的搜索历史在前，其后为列表分组 */
const keyboardItems = computed(() => [
  ...(trimmedQuery.value
    ? []
    : data.searchHistory.map((word) => ({ id: `history-${word}`, action: () => submit(word) }))),
  ...listSections.value.flatMap((sec) => sec.items),
]);

watch(keyboardItems, () => {
  activeIndex.value = -1;
});

const isActive = (id: string) =>
  activeIndex.value >= 0 && keyboardItems.value[activeIndex.value]?.id === id;

const scrollToActive = async () => {
  await nextTick();
  const id = keyboardItems.value[activeIndex.value]?.id;
  if (!id) return;
  bodyRef.value
    ?.querySelector(`[data-search-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
};

const onKeydown = (e: KeyboardEvent) => {
  const count = keyboardItems.value.length;
  if (e.key === "Escape") {
    if (!isCommand.value || e.isComposing) return;
    // 阻止弹窗关闭，只退出命令模式；SInput 按 Esc 会失焦，需要重新聚焦
    e.preventDefault();
    searchQuery.value = "";
    (e.target as HTMLElement).focus();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (count === 0) return;
    const step = e.key === "ArrowDown" ? 1 : -1;
    activeIndex.value = (activeIndex.value + step + count) % count;
    scrollToActive();
  } else if (e.key === "Enter") {
    if (e.isComposing) return;
    e.preventDefault();
    if (activeIndex.value >= 0 && activeIndex.value < count) {
      keyboardItems.value[activeIndex.value].action();
    } else if (isCommand.value) {
      // 命令模式未选中时执行第一项，无结果则不响应
      keyboardItems.value[0]?.action();
    } else {
      onSubmit();
    }
  }
};

watch(trimmedQuery, (kw, prev) => {
  if (!kw || prev) return;
  // 从默认视图进入输入时收起高度，内容高度不变时 ResizeObserver 不触发，下一帧主动测量一次
  bodyHeight.value = 0;
  requestAnimationFrame(() => {
    if (bodyHeight.value === 0 && bodyRef.value) {
      bodyHeight.value = bodyRef.value.offsetHeight;
    }
  });
});

watch(dialogOpen, (open) => {
  if (open) {
    searchQuery.value = "";
    loadPlayedTracks();
  } else {
    // 关闭复位：下次开弹仍是 auto 起手
    bodyHeight.value = null;
    activeIndex.value = -1;
  }
});
</script>

<template>
  <!-- 搜索框触发器与听歌识曲 -->
  <div class="flex items-center gap-2 shrink-0">
    <div
      role="button"
      :aria-label="t('nav.searchPlaceholder')"
      class="app-no-drag w-60 lt-compact:w-40 lt-md:w-10 h-10 px-4 lt-md:px-0 cursor-pointer flex items-center lt-md:justify-center gap-2 rounded-full border border-solid bg-on-surface/3 border-on-surface/15 hover:bg-on-surface/10 hover:border-on-surface/25 transition-colors duration-250 select-none"
      @click="dialogOpen = true"
      @contextmenu.prevent="dialogOpen = true"
      @mousedown.prevent
    >
      <IconLucideSearch class="size-4 text-on-surface-variant/50 shrink-0" />
      <span class="flex-1 min-w-0 truncate text-base text-on-surface-variant/40 lt-md:hidden">
        {{ t("nav.searchPlaceholder") }}
      </span>
    </div>
    <SButton
      class="app-no-drag shrink-0"
      variant="tertiary"
      circle
      :size="40"
      :icon-size="20"
      @click="recognitionOpen = true"
    >
      <template #icon><IconLucideAudioWaveform /></template>
    </SButton>
  </div>
  <!-- 听歌识曲 -->
  <RecognitionDialog v-model:open="recognitionOpen" />
  <!-- 搜索 -->
  <SDialog
    v-model:open="dialogOpen"
    :closable="false"
    :content-style="{ padding: 0 }"
    width="560px"
    top="12vh"
  >
    <div class="flex flex-col">
      <!-- 顶栏：输入框 -->
      <div class="px-4 pt-4 pb-3">
        <NavSearchInput
          v-model="searchQuery"
          :placeholder="t('nav.searchCommandHint')"
          @keydown="onKeydown"
          @search="submit"
        />
      </div>
      <div class="overflow-hidden transition-[height] duration-300 ease-out" :style="bodyStyle">
        <div
          ref="bodyRef"
          class="max-h-[65vh] overflow-y-auto px-4 pb-4 flex flex-col gap-4"
          @mousemove="activeIndex = -1"
        >
          <!-- 历史 -->
          <div v-if="!trimmedQuery && data.searchHistory.length > 0" class="flex flex-col gap-2">
            <div class="px-2 flex items-center justify-between">
              <div class="flex items-center gap-1.5 text-sm font-medium text-primary">
                <IconLucideHistory class="size-4" />
                <span>{{ t("nav.searchSection.history") }}</span>
              </div>
              <SButton variant="ghost" size="tiny" circle @click="onClearHistory">
                <template #icon><IconLucideTrash2 /></template>
              </SButton>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <STag
                v-for="word in data.searchHistory"
                :key="word"
                type="default"
                round
                closable
                class="max-w-50 cursor-pointer hover:bg-on-surface/20 transition-colors duration-200"
                :class="{ 'bg-on-surface/20': isActive(`history-${word}`) }"
                :data-search-id="`history-${word}`"
                @click="submit(word)"
                @close="data.removeSearchHistory(word)"
              >
                <span class="truncate">{{ word }}</span>
              </STag>
            </div>
          </div>
          <!-- 快捷跳转与搜索结果 / 命令 / 播放记录 -->
          <div v-for="sec in listSections" :key="sec.kind" class="flex flex-col gap-1.5">
            <div class="px-2 flex items-center gap-1.5 text-sm font-medium text-primary">
              <component :is="sec.icon" class="size-4" />
              <span>{{ sec.label }}</span>
            </div>
            <div
              v-for="entry in sec.items"
              :key="entry.id"
              class="min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-on-surface/5 transition-colors duration-200"
              :class="{ 'bg-on-surface/5': isActive(entry.id) }"
              :data-search-id="entry.id"
              @click="entry.action"
            >
              <component
                :is="entry.icon"
                v-if="entry.icon"
                class="size-4 shrink-0 text-on-surface-variant"
              />
              <div class="flex-1 min-w-0 flex flex-col leading-tight">
                <div class="min-w-0 flex items-center gap-1.5">
                  <span class="truncate text-sm text-on-surface">{{ entry.label }}</span>
                  <STag v-if="entry.local" size="tiny" type="default" class="shrink-0">
                    {{ t("collection.scope.local") }}
                  </STag>
                </div>
                <span v-if="entry.subtitle" class="truncate text-xs text-on-surface-variant">
                  {{ entry.subtitle }}
                </span>
              </div>
              <STag v-if="entry.shortcut" size="small" type="default" class="shrink-0">
                {{ entry.shortcut }}
              </STag>
              <IconLucideArrowRight
                v-if="entry.arrow"
                class="size-4 shrink-0 text-on-surface-variant"
              />
            </div>
          </div>
          <div v-if="placeholder" class="py-10 text-center text-on-surface-variant/50">
            <component :is="placeholder.icon" class="size-10 mx-auto mb-2 opacity-30" />
            <div class="text-sm">{{ placeholder.text }}</div>
          </div>
        </div>
      </div>
      <!-- 底部按键提示 -->
      <SDivider />
      <div class="px-4 py-2.5 flex items-center gap-4 text-xs text-on-surface-variant">
        <div v-for="hint in footerHints" :key="hint.keys" class="flex items-center gap-1.5">
          <STag size="tiny" type="default">{{ hint.keys }}</STag>
          <span>{{ hint.label }}</span>
        </div>
      </div>
    </div>
  </SDialog>
</template>
