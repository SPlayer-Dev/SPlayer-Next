<script setup lang="ts">
import type { Track } from "@shared/types/player";
import { ALL_PLATFORMS, PLATFORM_SHORT_NAME, type Platform } from "@shared/types/platform";
import type { TrackTags, TagEditRequest } from "@shared/types/tagEditor";
import { useStatusStore } from "@/stores/status";
import { searchSongs } from "@/apis/search";
import { rankTagCandidates, type RankedTagCandidate } from "@/utils/tagMatch";
import * as player from "@/core/player";
import { toast } from "@/composables/useToast";
import { handleError } from "@/utils/errors";
import { formatFileSize } from "@/utils/format";
import { formatTime } from "@/utils/time";
import IconWandSparkles from "~icons/lucide/wand-sparkles";

const props = defineProps<{ open: boolean; track: Track | null }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();

/** 文件名 */
const fileName = computed(() => props.track?.path?.split(/[/\\]/).pop() ?? "");

/** 格式 · 大小 摘要行 */
const fileMeta = computed(() => {
  const parts: string[] = [];
  const codec = props.track?.quality?.codec;
  if (codec) parts.push(codec.toUpperCase());
  const size = props.track?.fileSize;
  if (size) parts.push(formatFileSize(size));
  return parts.join(" · ");
});

/** 文件读出的原始标签快照 */
const original = shallowRef<TrackTags | null>(null);
const loading = ref(false);
const saving = ref(false);

/** 表单状态 */
const form = reactive({
  title: "",
  artist: "",
  album: "",
  albumArtist: "",
  genre: "",
  year: null as number | null,
  trackNumber: null as number | null,
  discNumber: null as number | null,
  lyrics: "",
});

/** 新封面 */
const newCoverPath = ref<string | null>(null);
const newCoverPreview = ref<string | null>(null);

/**
 * 重置表单为指定标签的值
 * @param tags 要回填的标签，null 表示重置为初始状态（全空）
 */
const resetForm = (tags: TrackTags | null): void => {
  form.title = tags?.title ?? "";
  form.artist = tags?.artist ?? "";
  form.album = tags?.album ?? "";
  form.albumArtist = tags?.albumArtist ?? "";
  form.genre = tags?.genre ?? "";
  form.year = tags?.year ?? null;
  form.trackNumber = tags?.trackNumber ?? null;
  form.discNumber = tags?.discNumber ?? null;
  form.lyrics = tags?.lyrics ?? "";
  newCoverPath.value = null;
  newCoverUrl.value = null;
  newCoverPreview.value = null;
  candidates.value = [];
  candidatesVisible.value = false;
};

/** 打开时读取文件标签回填 */
watch(
  () => props.open,
  async (open) => {
    if (!open || !props.track?.path) return;
    loading.value = true;
    original.value = null;
    resetForm(null);
    const result = await window.api.library.readTags(props.track.path);
    loading.value = false;
    if (!result.success || !result.data) {
      if (result.error) handleError(result.error);
      emit("update:open", false);
      return;
    }
    original.value = result.data;
    resetForm(result.data);
  },
);

/** 选择新封面 */
const pickCover = async (): Promise<void> => {
  const result = await window.api.library.pickCoverImage();
  if (!result.success || !result.data) return;
  newCoverPath.value = result.data.path;
  newCoverUrl.value = null;
  newCoverPreview.value = result.data.dataUrl;
};

/** 在线封面 URL */
const newCoverUrl = ref<string | null>(null);

/** 在线匹配平台，初始值跟随搜索页偏好，命名与搜索页同源 */
const matchPlatform = ref<Platform>(useStatusStore().searchPlatform);
const platformOptions = ALL_PLATFORMS.map((key) => ({
  value: key,
  label: PLATFORM_SHORT_NAME[key],
}));

const matching = ref(false);
const candidates = shallowRef<RankedTagCandidate[]>([]);
const candidatesVisible = ref(false);

/** 用表单当前的标题 + 艺术家联网搜索候选 */
const handleOnlineMatch = async (): Promise<void> => {
  const keyword = `${form.title.trim()} ${form.artist.trim()}`.trim();
  if (!keyword || matching.value) return;
  matching.value = true;
  try {
    const result = await searchSongs(matchPlatform.value, keyword, 0, 10);
    const ranked = rankTagCandidates(result.items, {
      title: form.title,
      artist: form.artist,
      album: form.album,
      durationMs: props.track?.duration,
    });
    candidates.value = ranked;
    candidatesVisible.value = ranked.length > 0;
    if (ranked.length === 0) toast.info(t("tagEditor.noMatches"));
  } catch {
    toast.error(t("errors.NETWORK_ERROR"));
  } finally {
    matching.value = false;
  }
};

/** 选中候选后拉取该平台歌词 */
const fillLyricFromCandidate = async (track: Track): Promise<void> => {
  // 特殊 ID 处理
  const lookupId = matchPlatform.value === "qqmusic" ? (track.extId ?? track.id) : track.id;
  try {
    const resp = await window.api.lyrics.matchById(matchPlatform.value, lookupId);
    if (resp.ok && resp.data?.content) form.lyrics = resp.data.content;
  } catch {
    // 拉取失败保留现有歌词，不打断匹配流程
  }
};

/** 回填候选到表单 */
const applyCandidate = (candidate: RankedTagCandidate): void => {
  const online = candidate.track;
  form.title = online.title;
  form.artist = online.artists.map((artist) => artist.name).join("/");
  if (online.album?.name) form.album = online.album.name;
  const coverUrl = online.coverOriginal ?? online.cover;
  if (coverUrl && /^https?:\/\//i.test(coverUrl)) {
    newCoverUrl.value = coverUrl;
    newCoverPath.value = null;
    newCoverPreview.value = coverUrl;
  }
  candidatesVisible.value = false;
  void fillLyricFromCandidate(online);
};

/** 文本字段 diff */
const diffText = (origValue: string | undefined, current: string): string | undefined => {
  return (origValue ?? "") === current ? undefined : current;
};

/** 数字字段 diff */
const diffNumber = (origValue: number | undefined, current: number | null): number | undefined => {
  const next = current ?? 0;
  return (origValue ?? 0) === next ? undefined : next;
};

/** 保存标签 */
const handleSave = async (): Promise<void> => {
  const track = props.track;
  const tags = original.value;
  if (!track?.path || !tags || saving.value) return;
  // 构造编辑请求，仅包含变更的字段
  const edit: TagEditRequest = {
    path: track.path,
    title: diffText(tags.title, form.title.trim()),
    artist: diffText(tags.artist, form.artist.trim()),
    album: diffText(tags.album, form.album.trim()),
    albumArtist: diffText(tags.albumArtist, form.albumArtist.trim()),
    genre: diffText(tags.genre, form.genre.trim()),
    year: diffNumber(tags.year, form.year),
    trackNumber: diffNumber(tags.trackNumber, form.trackNumber),
    discNumber: diffNumber(tags.discNumber, form.discNumber),
    lyrics: diffText(tags.lyrics, form.lyrics),
    coverPath: newCoverPath.value ?? undefined,
    coverUrl: newCoverUrl.value ?? undefined,
  };
  // 如果没有任何变更，直接关闭对话框
  const changed = Object.entries(edit).some(
    ([key, value]) => key !== "path" && value !== undefined,
  );
  if (!changed) {
    emit("update:open", false);
    return;
  }
  // 批量写入标签
  saving.value = true;
  const outcomes = await player.saveTrackTags([edit]);
  saving.value = false;
  const outcome = outcomes?.[0];
  if (outcome?.success) {
    toast.success(t("tagEditor.saveSuccess"));
    emit("update:open", false);
  } else if (outcome?.error) {
    toast.error(`${t("tagEditor.saveFailed")}: ${outcome.error}`);
  }
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('tagEditor.title')"
    width="560px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4">
      <!-- 封面 -->
      <div class="flex items-stretch gap-4">
        <SImg
          :src="newCoverPreview ?? track?.cover"
          class="size-24 shrink-0 rounded-lg overflow-hidden"
        />
        <div class="flex flex-col justify-between min-w-0 py-0.5">
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-sm font-medium truncate" :title="fileName">{{ fileName }}</span>
            <span class="text-xs text-on-surface-variant/70 truncate" :title="track?.path">
              {{ track?.path }}
            </span>
            <span v-if="fileMeta" class="text-xs text-on-surface-variant/70">{{ fileMeta }}</span>
          </div>
          <SButton variant="secondary" size="small" class="w-fit" @click="pickCover">
            {{ t("tagEditor.replaceCover") }}
          </SButton>
        </div>
      </div>
      <!-- 在线匹配 -->
      <SCard size="small" variant="primary">
        <div class="flex items-center gap-2">
          <span class="flex-1 text-sm text-on-surface">{{ t("tagEditor.matchHint") }}</span>
          <div class="w-24 shrink-0">
            <SSelect v-model="matchPlatform" :options="platformOptions" />
          </div>
          <SButton
            type="primary"
            size="small"
            class="shrink-0"
            :loading="matching"
            :disabled="!form.title.trim() && !form.artist.trim()"
            @click="handleOnlineMatch"
          >
            <template #icon><IconWandSparkles /></template>
            {{ t("tagEditor.onlineMatch") }}
          </SButton>
        </div>
        <!-- 候选列表在同一卡片内展开 -->
        <div v-if="candidatesVisible" class="mt-2.5 flex flex-col gap-0.5 max-h-56 overflow-y-auto">
          <div
            v-for="candidate in candidates"
            :key="candidate.track.id"
            role="button"
            tabindex="0"
            :class="[
              'flex items-center gap-2.5 p-1.5 rounded-md cursor-pointer transition-colors hover:bg-on-surface/8',
              candidate.durationFar && 'opacity-45',
            ]"
            @click="applyCandidate(candidate)"
            @keydown.enter="applyCandidate(candidate)"
          >
            <SImg
              :src="candidate.track.cover"
              class="size-10 shrink-0 rounded-md overflow-hidden"
            />
            <div class="flex flex-col min-w-0 flex-1">
              <span class="text-sm truncate">{{ candidate.track.title }}</span>
              <span class="text-xs text-on-surface-variant/70 truncate">
                {{ candidate.track.artists.map((artist) => artist.name).join(" / ") }}
                <template v-if="candidate.track.album?.name">
                  · {{ candidate.track.album.name }}
                </template>
              </span>
            </div>
            <span class="text-xs text-on-surface-variant/70 tabular-nums shrink-0">
              {{ formatTime(candidate.track.duration) }}
            </span>
          </div>
        </div>
      </SCard>
      <!-- 文本标签 -->
      <div class="grid grid-cols-2 gap-3">
        <label class="flex flex-col gap-1 col-span-2">
          <span class="text-xs text-on-surface-variant">{{ t("tagEditor.fields.title") }}</span>
          <SInput v-model="form.title" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-on-surface-variant">{{ t("tagEditor.fields.artist") }}</span>
          <SInput v-model="form.artist" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-on-surface-variant">
            {{ t("tagEditor.fields.albumArtist") }}
          </span>
          <SInput v-model="form.albumArtist" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-on-surface-variant">{{ t("tagEditor.fields.album") }}</span>
          <SInput v-model="form.album" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-on-surface-variant">{{ t("tagEditor.fields.genre") }}</span>
          <SInput v-model="form.genre" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-on-surface-variant">{{ t("tagEditor.fields.year") }}</span>
          <SNumberInput v-model="form.year" :min="0" :max="9999" />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-xs text-on-surface-variant">
              {{ t("tagEditor.fields.trackNumber") }}
            </span>
            <SNumberInput v-model="form.trackNumber" :min="0" :max="9999" />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-xs text-on-surface-variant">
              {{ t("tagEditor.fields.discNumber") }}
            </span>
            <SNumberInput v-model="form.discNumber" :min="0" :max="999" />
          </label>
        </div>
      </div>
      <!-- 内嵌歌词 -->
      <label class="flex flex-col gap-1">
        <span class="text-xs text-on-surface-variant">{{ t("tagEditor.fields.lyrics") }}</span>
        <SInput
          v-model="form.lyrics"
          type="textarea"
          :rows="6"
          resize="vertical"
          :placeholder="t('tagEditor.lyricsPlaceholder')"
        />
      </label>
    </div>
    <template #footer>
      <SButton variant="secondary" :disabled="saving" @click="emit('update:open', false)">
        {{ t("common.cancel") }}
      </SButton>
      <SButton :loading="saving" :disabled="loading" @click="handleSave">
        {{ t("common.save") }}
      </SButton>
    </template>
  </SDialog>
</template>
