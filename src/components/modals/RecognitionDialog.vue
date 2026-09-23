<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { RecognitionCandidate } from "@shared/types/recognition";
import { songsByIds as getNeteaseSongsByIds } from "@/apis/song/netease";
import { toast } from "@/composables/useToast";
import { useRecognitionSession } from "@/composables/useRecognitionSession";
import * as player from "@/core/player";
import { withPicSize } from "@/utils/format/netease";
import IconLucideArrowLeft from "~icons/lucide/arrow-left";
import IconLucideAudioWaveform from "~icons/lucide/audio-waveform";
import IconLucidePlay from "~icons/lucide/play";
import IconLucideSearch from "~icons/lucide/search";

const { t } = useI18n();
const router = useRouter();
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const session = useRecognitionSession();
const { phase, level, candidates, error, supported, source } = session;

const isBusy = computed(() => ["capturing", "fingerprinting", "matching"].includes(phase.value));
const trackCache = shallowRef(new Map<string, Track>());
const playingId = ref<string | null>(null);

watch(candidates, () => {
  trackCache.value = new Map();
  playingId.value = null;
});

watch(phase, (value) => {
  if (value === "error") {
    toast.error(t(`recognition.error.${error.value?.code ?? "unknown"}`));
    session.reset();
    return;
  }
  if (value === "done" && candidates.value.length === 0) {
    toast.info(t("recognition.empty"));
    session.reset();
    return;
  }
});

watch(
  () => props.open,
  (value) => {
    if (value) session.reset();
    else session.stop(false);
  },
);

const bars = computed(() => {
  const count = 14;
  // 保证弱信号也有明显波动
  const boosted = Math.min(1, Math.pow(level.value, 0.35) * 1.6);
  return Array.from({ length: count }, (_, index) => {
    const distance = Math.abs(index - (count - 1) / 2) / (count / 2);
    return Math.max(0.14, Math.min(1, boosted * (1 - distance * 0.55)));
  });
});

/** 获取标准歌曲对象并立即播放 */
const playCandidate = async (candidate: RecognitionCandidate): Promise<void> => {
  if (playingId.value === candidate.songId) return;
  let track = trackCache.value.get(candidate.songId);
  if (!track) {
    const [fetched] = await getNeteaseSongsByIds([Number(candidate.songId)]);
    if (!fetched) return;
    track = fetched;
    const next = new Map(trackCache.value);
    next.set(candidate.songId, fetched);
    trackCache.value = next;
  }
  playingId.value = candidate.songId;
  try {
    await player.playNow(track);
  } finally {
    playingId.value = null;
  }
};

/** 关闭弹窗并跳转到歌曲搜索 */
const searchCandidate = (candidate: RecognitionCandidate): void => {
  onOpenUpdate(false);
  void router.push({
    name: "search",
    query: { q: [candidate.title, ...candidate.artists].join(" ") },
  });
};

const onOpenUpdate = (value: boolean): void => {
  emit("update:open", value);
};

const start = (): void => {
  void session.start(source.value);
};
</script>

<template>
  <SDialog
    :open="props.open"
    :destroy-on-close="true"
    :title="t('recognition.title')"
    width="420px"
    height="360px"
    :content-style="{ padding: '0 20px' }"
    @update:open="onOpenUpdate"
  >
    <div class="flex h-full min-h-0 flex-col">
      <div
        v-if="phase === 'idle' || isBusy"
        class="flex min-h-0 flex-1 flex-col text-center"
        aria-live="polite"
      >
        <div class="flex flex-1 flex-col items-center justify-center">
          <div class="relative mb-3 size-20 shrink-0" aria-hidden="true">
            <div
              class="absolute inset-0 flex items-center justify-center rounded-full bg-primary/10 text-primary transition-[opacity,scale,filter] duration-240 ease-[cubic-bezier(0.2,0,0,1)]"
              :class="
                isBusy
                  ? 'pointer-events-none scale-25 opacity-0 blur-1'
                  : 'scale-100 opacity-100 blur-0'
              "
            >
              <IconLucideAudioWaveform class="size-9" />
            </div>
            <div
              class="absolute inset-0 flex items-center justify-center gap-1 transition-[opacity,scale,filter] duration-240 ease-[cubic-bezier(0.2,0,0,1)]"
              :class="
                isBusy
                  ? 'scale-100 opacity-100 blur-0'
                  : 'pointer-events-none scale-25 opacity-0 blur-1'
              "
            >
              <span
                v-for="(height, index) in bars"
                :key="index"
                class="h-10 w-1 origin-center rounded-full bg-primary transition-transform duration-150"
                :style="{ transform: `scaleY(${height})` }"
              />
            </div>
          </div>

          <div class="flex h-12 shrink-0 flex-col items-center">
            <p class="text-sm font-medium text-on-surface">
              {{ isBusy ? t(`recognition.phase.${phase}`) : t("recognition.description") }}
            </p>
            <p class="mt-1 max-w-80 text-xs leading-5 text-on-surface-variant/60 text-pretty">
              {{ isBusy ? t(`recognition.source.${source}`) : t(`recognition.hint.${source}`) }}
            </p>
          </div>
        </div>

        <div
          v-if="phase === 'idle' && supported"
          class="mt-auto flex h-8 shrink-0 items-center justify-center"
        >
          <div class="flex items-center gap-5">
            <span class="text-xs text-on-surface-variant/60">
              {{ t("recognition.sourceLabel") }}
            </span>
            <SRadioGroup v-model:value="source" size="small" class="flex gap-4">
              <SRadio value="system" :label="t('recognition.source.system')" />
              <SRadio value="microphone" :label="t('recognition.source.microphone')" />
            </SRadioGroup>
          </div>
        </div>
      </div>

      <div v-else-if="phase === 'done'" class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <div
          v-for="candidate in candidates"
          :key="candidate.songId"
          class="flex min-h-16 items-center gap-3 rounded-lg bg-on-surface/4 p-2 pr-3"
        >
          <SImg
            :src="withPicSize(candidate.cover, 300)"
            :alt="candidate.title"
            class="size-12 shrink-0 rounded-md outline outline-1 outline-black/10 dark:outline-white/10"
            decoding="async"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-on-surface">{{ candidate.title }}</p>
            <p class="mt-0.5 truncate text-xs text-on-surface-variant/60">
              {{ candidate.artists.join(" / ") }}
            </p>
          </div>
          <SButton variant="ghost" circle @click="searchCandidate(candidate)">
            <template #icon><IconLucideSearch /></template>
          </SButton>
          <SButton
            type="primary"
            variant="tertiary"
            circle
            :loading="playingId === candidate.songId"
            @click="playCandidate(candidate)"
          >
            <template #icon><IconLucidePlay class="translate-x-0.25" /></template>
          </SButton>
        </div>
      </div>
    </div>

    <template #footer>
      <SButton
        v-if="phase === 'idle'"
        type="primary"
        size="large"
        block
        :disabled="supported === null"
        @click="start"
      >
        <template #icon><IconLucideAudioWaveform /></template>
        {{ t("recognition.start") }}
      </SButton>
      <SButton v-else-if="isBusy" variant="secondary" size="large" block @click="session.stop()">
        {{ t("recognition.cancel") }}
      </SButton>
      <SButton
        v-else-if="phase === 'done'"
        variant="secondary"
        size="large"
        block
        @click="session.reset()"
      >
        <template #icon><IconLucideArrowLeft /></template>
        {{ t("common.back") }}
      </SButton>
    </template>
  </SDialog>
</template>
