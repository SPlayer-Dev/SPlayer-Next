<script setup lang="ts">
import type { LyricLine, LyricWord } from "lyric-kit";
import type {
  LyricCandidateTag,
  LyricManualMatch,
  LyricMatchSource,
  LyricSearchCandidate,
} from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { ALL_PLATFORMS, PLATFORM_SHORT_NAME } from "@shared/types/platform";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { toast } from "@/composables/useToast";
import { usePlaybackTime } from "@/composables/usePlaybackTime";
import { loadForTrack } from "@/services/lyric/loader";
import { invalidatePreloadedLyric } from "@/services/lyric/preload";
import { requestManualLyric } from "@/services/lyric/resolve";
import { parseMainLines } from "@/services/lyric/verify";
import { formatTime } from "@/utils/time";

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const media = useMediaStore();
const settings = useSettingsStore();
const status = useStatusStore();

const TTML_LABEL = "TTML";

/** 预览用的歌词行 */
interface PreviewLine {
  text: string;
  words: LyricWord[];
  startTime: number;
  /** 对唱行，靠右显示 */
  isDuet: boolean;
}

const TAG_LABEL_KEYS: Record<LyricCandidateTag, string> = {
  name: "player.lyricMatch.tagName",
  artist: "player.lyricMatch.tagArtist",
  duration: "player.lyricMatch.tagDuration",
};

/** 歌词来源分页，TTML 跟随在线 TTML 开关 */
const sourceTabs = computed<{ key: LyricMatchSource; label: string }[]>(() => [
  ...ALL_PLATFORMS.map((platform) => ({
    key: platform,
    label: PLATFORM_SHORT_NAME[platform],
  })),
  ...(settings.system.lyric.enableOnlineTTMLLyric
    ? [{ key: "ttml" as const, label: TTML_LABEL }]
    : []),
]);

/** 打开弹窗时的歌曲 */
const target = shallowRef<Track | null>(null);
const keyword = ref("");
const activePlatform = ref<LyricMatchSource>(ALL_PLATFORMS[0]);
/** 本次弹窗内各来源的搜索结果，切回已搜索的来源时不重复请求 */
const results = shallowRef<Partial<Record<LyricMatchSource, LyricSearchCandidate[]>>>({});
const searching = ref(false);
/** 已保存的手动选择 */
const currentMatch = shallowRef<LyricManualMatch | null>(null);
/** 当前预览的候选，为空时预览的是正在使用的歌词 */
const selected = shallowRef<LyricSearchCandidate | null>(null);
const previewLines = shallowRef<PreviewLine[]>([]);
const previewRef = useTemplateRef<HTMLElement>("previewRef");
const previewFormat = ref("");
const previewing = ref(false);
const saving = ref(false);

let searchToken = 0;
let previewToken = 0;

/** 判断两个候选是否指向同一首平台歌曲 */
const isSameMatch = (left: LyricManualMatch | null, right: LyricManualMatch): boolean =>
  left?.platform === right.platform && left.id === right.id;

/**
 * 判断候选是否就是正在使用的歌词
 * @param match - 候选
 * @returns 是否正在使用
 */
const isCurrent = (match: LyricSearchCandidate): boolean => {
  if (currentMatch.value) return isSameMatch(currentMatch.value, match);
  const active = media.activeLyric;
  if (active?.source !== "online" || !match.autoMatched) return false;
  return match.platform === (active.format === "ttml" ? "ttml" : active.platform);
};

/** 当前来源的候选，正在使用的排在最前 */
const candidates = computed(() => {
  const list = results.value[activePlatform.value];
  const current = list?.find(isCurrent);
  return current ? [current, ...list!.filter((match) => match !== current)] : list;
});

/** 预览内容是否为正在使用的歌词 */
const previewingCurrent = computed(() => !selected.value || isCurrent(selected.value));

/**
 * 提取预览用的主歌词行
 * @param lines - 歌词行
 * @returns 有文本的主歌词行
 */
const toPreviewLines = (lines: LyricLine[]): PreviewLine[] =>
  lines
    .filter((line) => !line.isBG)
    .map((line) => ({
      text: line.words
        .map((word) => word.word)
        .join("")
        .trim(),
      words: line.words,
      startTime: line.startTime,
      isDuet: line.isDuet,
    }))
    .filter((line) => line.text);

/** 正在播放的行，未开始时为 -1 */
const activeIndex = ref(-1);

let lastTime = -1;
let lastLines: PreviewLine[] = [];

// 非响应式时间源，暂停时时间和内容都不变就跳过，避免每帧重复写样式
const { start: startTick, stop: stopTick } = usePlaybackTime((currentMs) => {
  const time = currentMs + status.lyricOffsetMs;
  const lines = previewLines.value;
  if (time === lastTime && lines === lastLines) return;
  lastLines = lines;
  const index = lines.findLastIndex((line) => line.startTime <= time);
  // 换行后逐字节点下一帧才渲染出来，留到下一帧再写进度
  if (index !== activeIndex.value) {
    activeIndex.value = index;
    lastTime = -1;
    return;
  }
  lastTime = time;
  const words = lines[index]?.words;
  if (!words || words.length < 2) return;
  previewRef.value
    ?.querySelectorAll<HTMLElement>(`[data-index="${index}"] > span`)
    .forEach((span, wordIndex) => {
      const word = words[wordIndex];
      const progress = (time - word.startTime) / Math.max(word.endTime - word.startTime, 1);
      span.style.setProperty("--fill", `${Math.min(Math.max(progress, 0), 1) * 100}%`);
    });
});

/** 预览正在使用的歌词，内容已在内存里，不用再请求 */
const showCurrentLyric = (): void => {
  previewToken++;
  previewing.value = false;
  previewFormat.value = media.lyricFormat?.toUpperCase() ?? "";
  previewLines.value = toPreviewLines(media.parsedLyric);
};

/**
 * 计算候选与当前歌曲的时长差
 * @param match - 候选
 * @returns 时长差（毫秒），缺少时长时为 null
 */
const durationDiff = (match: LyricManualMatch): number | null => {
  const duration = target.value?.duration;
  if (!match.duration || !duration) return null;
  const diff = match.duration - duration;
  // 不足半秒的差异显示出来只会是 0s
  return Math.abs(diff) < 500 ? null : diff;
};

/** 格式化时长差 */
const formatDiff = (diff: number): string => {
  const seconds = Math.round(diff / 1000);
  return seconds > 0 ? `+${seconds}s` : `${seconds}s`;
};

/** 搜索当前来源 */
const runSearch = async (): Promise<void> => {
  const text = keyword.value.trim();
  const track = target.value;
  if (!text || !track) {
    searching.value = false;
    return;
  }
  const platform = activePlatform.value;
  const token = ++searchToken;
  searching.value = true;
  const resp = await window.api.lyrics.searchCandidates(platform, text, track);
  if (token !== searchToken) return;
  searching.value = false;
  if (!resp.ok) {
    toast.error(t("player.lyricMatch.searchFailed"));
    return;
  }
  results.value = { ...results.value, [platform]: resp.data };
  selected.value ??= resp.data.find(isCurrent) ?? null;
};

/** 按新关键词重新搜索，其他来源切换时再请求 */
const handleSearch = (): void => {
  if (!keyword.value.trim()) return;
  results.value = {};
  void runSearch();
};

/**
 * 切换来源，未搜索过时才发起请求
 * @param key - 来源
 */
const switchPlatform = (key: string): void => {
  activePlatform.value = key as LyricMatchSource;
  if (!results.value[activePlatform.value]) void runSearch();
};

/**
 * 预览候选歌词，只在点击时请求，避免触发平台限流
 * @param match - 候选
 */
const previewMatch = async (match: LyricSearchCandidate): Promise<void> => {
  const track = target.value;
  if (!track) return;
  selected.value = match;
  if (isCurrent(match)) {
    showCurrentLyric();
    return;
  }
  const token = ++previewToken;
  previewLines.value = [];
  previewing.value = true;
  const lyric = await requestManualLyric(track, match);
  if (token !== previewToken) return;
  previewing.value = false;
  if (!lyric) return;
  previewFormat.value = lyric.source.format.toUpperCase();
  previewLines.value = toPreviewLines(parseMainLines(lyric.source.format, lyric.input.content));
};

/**
 * 写入选择后重新加载歌词
 * @param write - 写入操作
 */
const saveAndReload = async (write: (track: Track) => Promise<void>): Promise<void> => {
  const track = target.value;
  if (!track || saving.value) return;
  saving.value = true;
  try {
    await write(track);
    // 下一首预载可能是同一首歌，旧结果不能再用
    invalidatePreloadedLyric();
    await loadForTrack(media.detail);
    emit("update:open", false);
  } catch {
    toast.error(t("player.lyricMatch.saveFailed"));
  } finally {
    saving.value = false;
  }
};

/** 应用当前预览的候选 */
const handleApply = (): void => {
  const match = selected.value;
  if (match) void saveAndReload((track) => window.api.lyrics.setManualMatch(track, match));
};

/** 恢复自动匹配 */
const handleRestore = (): void => {
  void saveAndReload((track) => window.api.lyrics.clearManualMatch(track));
};

/** 打开时搜索当前歌曲，关闭时释放候选和预览 */
watch(
  () => props.open,
  async (open) => {
    if (open) startTick();
    else stopTick();
    searchToken++;
    previewToken++;
    results.value = {};
    selected.value = null;
    currentMatch.value = null;
    previewLines.value = [];
    previewing.value = false;
    const track = open ? toRaw(media.track) : null;
    target.value = track;
    searching.value = Boolean(track);
    if (!track) return;
    keyword.value = [track.title, ...track.artists.map((artist) => artist.name)].join(" ");
    showCurrentLyric();
    currentMatch.value = await window.api.lyrics.getManualMatch(track);
    if (target.value !== track) return;
    const active = media.activeLyric;
    const currentSource =
      currentMatch.value?.platform ??
      (active?.source === "online" && active.format === "ttml" ? "ttml" : active?.platform);
    activePlatform.value =
      sourceTabs.value.find((tab) => tab.key === currentSource)?.key ?? ALL_PLATFORMS[0];
    void runSearch();
  },
);

/** 当前行变化时滚动到预览区中间 */
watch(
  [activeIndex, previewLines],
  () => {
    const container = previewRef.value;
    const line = container?.querySelector<HTMLElement>(`[data-index="${activeIndex.value}"]`);
    if (!container || !line) return;
    container.scrollTo({
      top: line.offsetTop - (container.clientHeight - line.clientHeight) / 2,
      behavior: "smooth",
    });
  },
  { flush: "post" },
);

/** 切歌后关闭，避免把选择写到下一首 */
watch(
  () => media.track?.id,
  () => {
    if (props.open) emit("update:open", false);
  },
);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('player.lyricMatch.title')"
    width="760px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <SInput
          v-model="keyword"
          class="flex-1"
          clearable
          :placeholder="t('player.lyricMatch.searchPlaceholder')"
          @keyup.enter="handleSearch"
        />
        <SButton type="primary" :loading="searching" @click="handleSearch">
          {{ t("player.lyricMatch.search") }}
        </SButton>
      </div>
      <STabs
        :model-value="activePlatform"
        :tabs="sourceTabs"
        type="bar"
        size="small"
        @update:model-value="switchPlatform"
      />
      <div class="grid grid-cols-2 gap-3 h-[46vh] min-h-0">
        <div class="flex flex-col gap-1 min-h-0 overflow-y-auto">
          <div
            v-if="searching && !candidates"
            class="flex-1 flex items-center justify-center text-xl text-on-surface/50"
          >
            <SLoading />
          </div>
          <p v-else-if="!candidates?.length" class="m-auto text-sm text-on-surface/50 text-center">
            {{ t("player.lyricMatch.noResults") }}
          </p>
          <SCard
            v-for="match in candidates"
            :key="match.id"
            size="small"
            variant="settings"
            :selected="isSameMatch(selected, match)"
            :class="{ 'hover:border-primary/50': !isSameMatch(selected, match) }"
            class="shrink-0 flex flex-col gap-0.5 cursor-pointer"
            @click="previewMatch(match)"
          >
            <span class="flex items-center gap-1.5 min-w-0">
              <span class="text-sm text-on-surface truncate">{{ match.name }}</span>
              <STag v-if="isCurrent(match)" size="tiny" class="shrink-0">
                {{ t("player.lyricMatch.current") }}
              </STag>
            </span>
            <span class="text-xs text-on-surface/60 truncate">
              {{ match.artist }}
              <template v-if="match.album">· {{ match.album }}</template>
            </span>
            <span class="flex flex-wrap items-center gap-1 text-xs text-on-surface/45 tabular-nums">
              <span v-if="match.duration" class="mr-0.5">
                {{ formatTime(match.duration) }}
                <span v-if="durationDiff(match)">({{ formatDiff(durationDiff(match)!) }})</span>
              </span>
              <STag v-if="match.best" size="tiny" type="success">
                {{ t("player.lyricMatch.tagBest") }}
              </STag>
              <STag v-for="tag in match.tags" :key="tag" size="tiny" type="default">
                {{ t(TAG_LABEL_KEYS[tag]) }}
              </STag>
            </span>
          </SCard>
        </div>
        <div class="flex flex-col gap-2 min-h-0">
          <div
            v-if="!previewing && previewLines.length > 0"
            class="shrink-0 flex items-center gap-1 rounded-md bg-on-surface/4 px-3 py-2"
          >
            <STag size="tiny">{{ previewFormat }}</STag>
            <STag v-if="previewingCurrent" size="tiny">
              {{ t("player.lyricMatch.current") }}
            </STag>
          </div>
          <div
            ref="previewRef"
            class="relative flex-1 flex flex-col min-h-0 overflow-y-auto rounded-md bg-on-surface/4 px-3 py-2.5 gap-1"
          >
            <div
              v-if="previewing"
              class="flex-1 flex items-center justify-center text-xl text-on-surface/50"
            >
              <SLoading />
            </div>
            <p
              v-else-if="previewLines.length === 0"
              class="m-auto text-sm text-on-surface/50 text-center"
            >
              {{ selected ? t("player.lyricMatch.noLyric") : t("player.lyricMatch.previewHint") }}
            </p>
            <template v-else>
              <p
                v-for="(line, index) in previewLines"
                :key="index"
                :data-index="index"
                class="m-0 text-sm leading-relaxed transition-colors duration-200"
                :class="[
                  line.isDuet && 'text-right',
                  index !== activeIndex
                    ? 'text-on-surface/45'
                    : line.words.length > 1
                      ? 'text-on-surface'
                      : 'text-primary',
                ]"
              >
                <template v-if="index === activeIndex && line.words.length > 1">
                  <span
                    v-for="(word, wordIndex) in line.words"
                    :key="wordIndex"
                    class="preview-word"
                  >
                    {{ word.word }}
                  </span>
                </template>
                <template v-else>{{ line.text }}</template>
              </p>
            </template>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <span v-if="currentMatch" class="mr-auto min-w-0 text-xs text-on-surface/50 truncate">
        {{
          t("player.lyricMatch.currentPick", {
            name: currentMatch.name,
            platform:
              currentMatch.platform === "ttml"
                ? TTML_LABEL
                : PLATFORM_SHORT_NAME[currentMatch.platform],
          })
        }}
      </span>
      <SButton v-if="currentMatch" variant="secondary" :disabled="saving" @click="handleRestore">
        {{ t("player.lyricMatch.restoreAuto") }}
      </SButton>
      <SButton variant="secondary" @click="emit('update:open', false)">
        {{ t("common.cancel") }}
      </SButton>
      <SButton
        type="primary"
        :loading="saving"
        :disabled="previewingCurrent || previewLines.length === 0"
        @click="handleApply"
      >
        {{ t("player.lyricMatch.apply") }}
      </SButton>
    </template>
  </SDialog>
</template>

<style scoped>
.preview-word {
  background-image: linear-gradient(
    90deg,
    rgb(var(--s-primary)) var(--fill, 0%),
    rgb(var(--s-on-surface) / 0.45) var(--fill, 0%)
  );
  background-clip: text;
  color: transparent;
}
</style>
