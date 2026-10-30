<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { useThemeStore } from "@/stores/theme";
import { useCopyText } from "@/composables/useCopyText";
import { toast } from "@/composables/useToast";
import { createLyricPoster } from "@/utils/lyric/poster";
import type { LyricLanguage, LyricLine } from "lyric-kit";

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const media = useMediaStore();
const theme = useThemeStore();
const settings = useSettingsStore();
const { copy } = useCopyText();

/** 复制内容过滤项 */
type CopyFilter = "translation" | "romaji" | "background" | "emptyLine" | "songName" | "artist";

/** 选中的过滤项（默认开启翻译/音译/背景行/歌名/歌手，空行默认关闭） */
const selectedFilters = ref<CopyFilter[]>([
  "translation",
  "romaji",
  "background",
  "songName",
  "artist",
]);

/** 选中的歌词行索引 */
const selectedLines = ref<number[]>([]);

/** 选中背景行的所属主行索引，背景行仅随主行一起输出 */
const selectedBackgrounds = ref<number[]>([]);

/** 单段文本的展示内容 */
interface DisplayText {
  language?: LyricLanguage;
  text: string;
  translation: string;
  romaji: string;
}

/** 展示用歌词行，背景行附着在所属主行下 */
interface DisplayLyric extends DisplayText {
  index: number;
  duet: boolean;
  background?: DisplayText;
  /** 背景行起始早于主行（前置背景行），输出与展示时置于主行之前 */
  backgroundFirst?: boolean;
}

/**
 * 将歌词行转换为展示文本
 * @param line - 解析后的歌词行
 * @returns 展示文本
 */
const toDisplayText = (line: LyricLine): DisplayText => ({
  language: line.language,
  text: line.words.map((word) => word.word).join(""),
  translation: line.translatedLyric || "",
  romaji: line.romanLyric || line.words.map((word) => word.romanWord ?? "").join(""),
});

/** 展示用歌词行，紧随主行的背景行附着到该主行 */
/**
 * 获取歌词行的起始时间，取首个逐字时间以保留主行与背景行的原始先后
 * @param line - 歌词行
 * @returns 起始时间（毫秒）
 */
const lineStart = (line: LyricLine): number => line.words[0]?.startTime ?? line.startTime;

const displayLyrics = computed(() => {
  const result: DisplayLyric[] = [];
  const lines = media.parsedLyric;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const previous = result[result.length - 1];
    if (line.isBG && previous && !previous.background) {
      previous.background = toDisplayText(line);
      previous.backgroundFirst = lineStart(line) < lineStart(lines[idx - 1]);
      continue;
    }
    result.push({ ...toDisplayText(line), index: result.length, duet: line.isDuet });
  }
  return result;
});

/** 带背景行的主行索引 */
const backgroundIndexes = computed(() =>
  displayLyrics.value.filter((line) => line.background).map((line) => line.index),
);

const showTranslation = computed(() => selectedFilters.value.includes("translation"));
const showRomaji = computed(() => selectedFilters.value.includes("romaji"));
const showBackground = computed(() => selectedFilters.value.includes("background"));

/** 歌名 / 歌手后缀 */
const suffix = computed(() => {
  const withSongName = selectedFilters.value.includes("songName");
  const withArtist = selectedFilters.value.includes("artist");
  const track = media.track;
  if ((!withSongName && !withArtist) || !track) return "";
  const songName = track.title;
  const artistName = track.artists.map((artist) => artist.name).join(" / ");
  if (withSongName && withArtist) return `——《${songName}》 - ${artistName}`;
  if (withSongName) return `——《${songName}》`;
  return `—— ${artistName}`;
});

/** 已选行集合，加速勾选判断 */
const pickedSet = computed(() => new Set(selectedLines.value));

const backgroundPickedSet = computed(() => new Set(selectedBackgrounds.value));

const isAllSelected = computed(
  () => displayLyrics.value.length > 0 && selectedLines.value.length === displayLyrics.value.length,
);

/** 打开时默认全选 */
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    selectedLines.value = displayLyrics.value.map((line) => line.index);
    selectedBackgrounds.value = backgroundIndexes.value;
  },
);

/**
 * 勾选 / 取消某一行，取消主行时一并取消其背景行
 * @param index - 行索引
 * @param checked - 是否勾选
 */
const toggleLine = (index: number, checked: boolean): void => {
  if (!checked) {
    selectedLines.value = selectedLines.value.filter((item) => item !== index);
    selectedBackgrounds.value = selectedBackgrounds.value.filter((item) => item !== index);
  } else if (!selectedLines.value.includes(index)) {
    selectedLines.value = [...selectedLines.value, index];
  }
};

/**
 * 勾选 / 取消某一行的背景行
 * @param index - 所属主行索引
 * @param checked - 是否勾选
 */
const toggleBackground = (index: number, checked: boolean): void => {
  if (!checked) {
    selectedBackgrounds.value = selectedBackgrounds.value.filter((item) => item !== index);
  } else if (!selectedBackgrounds.value.includes(index)) {
    selectedBackgrounds.value = [...selectedBackgrounds.value, index];
  }
};

const toggleSelectAll = (): void => {
  const selectAll = !isAllSelected.value;
  selectedLines.value = selectAll ? displayLyrics.value.map((line) => line.index) : [];
  selectedBackgrounds.value = selectAll ? backgroundIndexes.value : [];
};

/** 反选 */
const invertSelection = (): void => {
  const picked = pickedSet.value;
  selectedLines.value = displayLyrics.value
    .map((line) => line.index)
    .filter((index) => !picked.has(index));
  const pickedBackground = backgroundPickedSet.value;
  selectedBackgrounds.value = backgroundIndexes.value.filter(
    (index) => !pickedBackground.has(index),
  );
};

/**
 * 为背景行补全括号，已带括号的文本保持不变
 * @param text - 背景行文本
 * @returns 带括号的文本
 */
const wrapBackground = (text: string): string => (/^[(（].*[)）]$/.test(text) ? text : `(${text})`);

/**
 * 获取随主行输出的背景行，需同时开启背景行开关且该背景行已勾选
 * @param line - 展示用歌词行
 * @returns 需输出的背景行，无则为 undefined
 */
const outputBackground = (line: DisplayLyric): DisplayText | undefined =>
  showBackground.value && backgroundPickedSet.value.has(line.index) ? line.background : undefined;

/** 复制歌词 */
const handleCopy = async (): Promise<void> => {
  const separator = selectedFilters.value.includes("emptyLine") ? "\n\n" : "\n";
  let content = displayLyrics.value
    .filter((line) => pickedSet.value.has(line.index))
    .map((line) => {
      const mainParts = [line.text];
      if (showTranslation.value && line.translation) mainParts.push(line.translation);
      if (showRomaji.value && line.romaji) mainParts.push(line.romaji);
      const backgroundParts: string[] = [];
      const background = outputBackground(line);
      if (background) {
        if (background.text) backgroundParts.push(wrapBackground(background.text));
        if (showTranslation.value && background.translation) {
          backgroundParts.push(wrapBackground(background.translation));
        }
        if (showRomaji.value && background.romaji) {
          backgroundParts.push(wrapBackground(background.romaji));
        }
      }
      const parts = line.backgroundFirst
        ? [...backgroundParts, ...mainParts]
        : [...mainParts, ...backgroundParts];
      return parts.filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join(separator);
  if (suffix.value) content += `${separator}${suffix.value}`;
  if (!content) {
    toast.warning(t("player.copyLyric.empty"));
    return;
  }
  await copy(content);
};

/** 复制歌词原文 */
const handleCopyRaw = async (): Promise<void> => {
  const content = media.lyricContent?.content;
  if (content) await copy(content);
};

/** 导出中，防重复点击 */
const exporting = ref(false);

/** 导出歌词图片 */
const handleExport = async (): Promise<void> => {
  const track = media.track;
  if (exporting.value || !track || !selectedLines.value.length) return;
  exporting.value = true;
  try {
    const blob = await createLyricPoster({
      track,
      lines: displayLyrics.value
        .filter((line) => pickedSet.value.has(line.index))
        .map((line) => {
          const background = outputBackground(line);
          return {
            text: line.text,
            language: line.language,
            translation: showTranslation.value && line.translation ? line.translation : undefined,
            romaji: showRomaji.value && line.romaji ? line.romaji : undefined,
            duet: line.duet,
            backgroundFirst: line.backgroundFirst,
            background: background
              ? {
                  text: background.text,
                  language: background.language,
                  translation:
                    showTranslation.value && background.translation
                      ? background.translation
                      : undefined,
                  romaji: showRomaji.value && background.romaji ? background.romaji : undefined,
                }
              : undefined,
          };
        }),
      fallbackColor: theme.coverColor,
      fonts: {
        global: settings.appearance.fontFamily,
        lyric: settings.lyric.fontFamily,
        chinese: settings.lyric.fontFamilyChinese,
        japanese: settings.lyric.fontFamilyJapanese,
        korean: settings.lyric.fontFamilyKorean,
        latin: settings.lyric.fontFamilyLatin,
      },
    });
    const artist = track.artists.map((item) => item.name).join(", ");
    const suffixName = t("player.copyLyric.fileSuffix");
    const fileName = `${track.title} - ${artist} - ${suffixName}.png`.replace(/[\\/:*?"<>|]/g, " ");
    const res = await window.api.system.saveFile(await blob.arrayBuffer(), fileName);
    if (res.success && res.path) toast.success(t("player.copyLyric.saved"));
    else if (!res.success) toast.error(t("player.copyLyric.exportFailed"));
  } catch {
    toast.error(t("player.copyLyric.exportFailed"));
  } finally {
    exporting.value = false;
  }
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('player.copyLyric.title')"
    width="540px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <!-- 歌词列表 -->
      <div class="max-h-[46vh] overflow-y-auto flex flex-col">
        <div
          v-for="line in displayLyrics"
          :key="line.index"
          class="flex flex-col"
          :class="line.backgroundFirst ? 'flex-col-reverse' : 'flex-col'"
        >
          <SCheckbox
            :checked="pickedSet.has(line.index)"
            class="w-full! px-2 py-1.5 rounded-md hover:bg-on-surface/5"
            @update:checked="toggleLine(line.index, $event)"
          >
            <div
              class="flex flex-1 flex-col gap-0.5 leading-snug"
              :class="line.duet && 'items-end text-right'"
            >
              <span v-if="line.text" class="text-sm text-on-surface">{{ line.text }}</span>
              <span v-if="showTranslation && line.translation" class="text-xs text-on-surface/60">
                {{ line.translation }}
              </span>
              <span v-if="showRomaji && line.romaji" class="text-xs italic text-on-surface/45">
                {{ line.romaji }}
              </span>
            </div>
          </SCheckbox>
          <SCheckbox
            v-if="showBackground && line.background"
            :checked="backgroundPickedSet.has(line.index)"
            :disabled="!pickedSet.has(line.index)"
            class="w-full! py-1 px-2 rounded-md hover:bg-on-surface/5"
            @update:checked="toggleBackground(line.index, $event)"
          >
            <div
              class="flex flex-1 flex-col gap-0.5 leading-snug"
              :class="line.duet ? 'items-end text-right pr-5' : 'pl-5'"
            >
              <span v-if="line.background.text" class="text-xs text-on-surface/40">
                {{ line.background.text }}
              </span>
              <span
                v-if="showTranslation && line.background.translation"
                class="text-[11px] text-on-surface/35"
              >
                {{ line.background.translation }}
              </span>
              <span
                v-if="showRomaji && line.background.romaji"
                class="text-[11px] italic text-on-surface/30"
              >
                {{ line.background.romaji }}
              </span>
            </div>
          </SCheckbox>
        </div>
      </div>
      <!-- 复制内容选项 -->
      <div class="flex flex-col gap-2 border-t border-outline-variant/30 pt-3">
        <span v-if="suffix" class="text-right text-xs text-on-surface/50 truncate">
          {{ suffix }}
        </span>
        <span class="text-xs text-on-surface/50">{{ t("player.copyLyric.contentLabel") }}</span>
        <div class="flex items-center gap-2">
          <SCheckboxGroup v-model:value="selectedFilters" size="small">
            <SCheckbox value="translation" :label="t('player.copyLyric.translation')" />
            <SCheckbox value="romaji" :label="t('player.copyLyric.romaji')" />
            <SCheckbox value="background" :label="t('player.copyLyric.background')" />
            <SCheckbox value="emptyLine" :label="t('player.copyLyric.emptyLine')" />
            <SCheckbox value="songName" :label="t('player.copyLyric.songName')" />
            <SCheckbox value="artist" :label="t('player.copyLyric.artist')" />
          </SCheckboxGroup>
          <SButton
            variant="secondary"
            size="tiny"
            class="ml-auto shrink-0"
            :disabled="!media.lyricContent"
            @click="handleCopyRaw"
          >
            {{ t("player.copyLyric.copyRaw") }}
          </SButton>
        </div>
      </div>
    </div>

    <template #footer>
      <span class="mr-auto text-xs text-on-surface/50 tabular-nums">
        {{ t("player.copyLyric.selected", { n: selectedLines.length }) }}
      </span>
      <SButton variant="secondary" @click="toggleSelectAll">
        {{ isAllSelected ? t("player.copyLyric.deselectAll") : t("player.copyLyric.selectAll") }}
      </SButton>
      <SButton variant="secondary" @click="invertSelection">
        {{ t("player.copyLyric.invert") }}
      </SButton>
      <SButton
        variant="secondary"
        :loading="exporting"
        :disabled="!selectedLines.length"
        @click="handleExport"
      >
        {{ t("player.copyLyric.exportImage") }}
      </SButton>
      <SButton type="primary" :disabled="!selectedLines.length" @click="handleCopy">
        {{ t("player.copyLyric.copy") }}
      </SButton>
    </template>
  </SDialog>
</template>
