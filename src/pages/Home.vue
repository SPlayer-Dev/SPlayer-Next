<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { useHomeHeader } from "@/composables/home/useHomeHeader";
import { useDailyRecommend } from "@/composables/home/useDailyRecommend";
import { useContinueListening } from "@/composables/home/useContinueListening";
import { useQuickActions } from "@/composables/home/useQuickActions";
import * as player from "@/core/player";

const { t } = useI18n();

/** 头部 */
const { greetingTitle, greetingSub, headerStats, load: loadHeader } = useHomeHeader();
/** 重点推荐 */
const {
  hero,
  loading: heroLoading,
  playAll: playHero,
  addToQueue: addHeroToQueue,
  load: loadHero,
} = useDailyRecommend();
/** 快捷入口 */
const { quickActions } = useQuickActions();
/** 继续聆听 / 反复聆听 */
const {
  tracks: continueTracks,
  title: continueTitle,
  subtitle: continueSubtitle,
  load: loadContinue,
} = useContinueListening();

onMounted(() => {
  void loadHeader();
  void loadHero();
  void loadContinue();
});

/** 拼接歌手名 */
const artistName = (track: Track): string => track.artists.map((artist) => artist.name).join(" / ");

/** 推荐歌单 */
const recommendPlaylists: CoverItem[] = Array.from({ length: 6 }, (_, index) => ({
  id: `placeholder-${index}`,
  title: `推荐歌单 ${index + 1}`,
  subtitle: "根据你的口味",
  trackCount: 0,
}));
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="mx-auto flex max-w-[1400px] flex-col gap-6 px-6 pt-6 pb-10">
      <!-- 问候 -->
      <header class="flex items-start justify-between gap-6">
        <div class="min-w-0">
          <h1 class="text-3xl font-bold text-on-surface">{{ greetingTitle }}</h1>
          <p class="mt-2 text-sm text-on-surface-variant/70">{{ greetingSub }}</p>
        </div>
        <div class="shrink-0 flex items-center gap-6">
          <div v-for="stat in headerStats" :key="stat.label" class="text-right">
            <div class="flex items-baseline justify-end gap-0.5">
              <span class="text-2xl font-bold text-on-surface tabular-nums">{{ stat.value }}</span>
              <span class="text-sm text-on-surface-variant">{{ stat.unit }}</span>
            </div>
            <div class="mt-0.5 text-xs text-on-surface-variant/50">{{ stat.label }}</div>
          </div>
        </div>
      </header>
      <!-- Hero -->
      <SCard v-if="heroLoading || hero" radius="xl" flush class="min-h-40 -mb-3">
        <div class="flex items-center gap-4 p-4">
          <!-- 封面 -->
          <div class="size-32 shrink-0 overflow-hidden rounded-xl">
            <SImg :src="hero?.cover" :alt="hero?.title" class="size-full" />
          </div>
          <!-- 信息 -->
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <STag v-if="hero" type="default" round size="small" class="self-start">
              {{ hero.tag }}
            </STag>
            <h2 class="truncate text-xl font-bold text-on-surface">{{ hero?.title }}</h2>
            <p class="truncate text-sm text-on-surface-variant/70">{{ hero?.subtitle }}</p>
            <div class="mt-0.5 flex items-center gap-2">
              <SButton type="primary" round :disabled="heroLoading" @click="playHero">
                <template #icon><IconLucidePlay /></template>
                {{ t("home.hero.play") }}
              </SButton>
              <SButton variant="secondary" round :disabled="heroLoading" @click="addHeroToQueue">
                <template #icon><IconLucidePlus /></template>
                {{ t("home.hero.addQueue") }}
              </SButton>
            </div>
          </div>
        </div>
      </SCard>
      <!-- 快捷入口 -->
      <section class="grid grid-cols-4 gap-3">
        <SCard
          v-for="action in quickActions"
          :key="action.title"
          radius="xl"
          hoverable
          class="flex items-center gap-3"
          @click="action.run()"
        >
          <div
            class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <component :is="action.icon" class="size-5" />
          </div>
          <div class="min-w-0">
            <div class="truncate text-sm font-medium text-on-surface">{{ action.title }}</div>
            <div class="truncate text-xs text-on-surface-variant/50">{{ action.desc }}</div>
          </div>
        </SCard>
      </section>
      <!-- 继续聆听 / 反复聆听 -->
      <section class="flex flex-col gap-3">
        <div>
          <h3 class="text-lg font-semibold text-on-surface">{{ continueTitle }}</h3>
          <p v-if="continueSubtitle" class="mt-0.5 text-xs text-on-surface-variant/50">
            {{ continueSubtitle }}
          </p>
        </div>
        <div v-if="continueTracks.length > 0" class="grid grid-cols-3 gap-3">
          <SCard
            v-for="track in continueTracks"
            :key="`${track.source}:${track.id}`"
            radius="xl"
            size="small"
            hoverable
            class="group flex items-center gap-3"
            @click="player.playNow(track)"
          >
            <div class="relative size-12 shrink-0">
              <SImg :src="track.cover" :alt="track.title" class="size-12 rounded-lg" />
              <div
                class="absolute inset-0 flex items-center justify-center rounded-lg bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              >
                <IconLucidePlay class="size-5 text-white" />
              </div>
            </div>
            <div class="min-w-0">
              <div class="truncate text-sm text-on-surface">{{ track.title }}</div>
              <div class="truncate text-xs text-on-surface-variant/50">{{ artistName(track) }}</div>
            </div>
          </SCard>
        </div>
        <div
          v-else
          class="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-on-surface/12 py-10 text-on-surface-variant/40"
        >
          <IconLucideHeadphones class="size-7" />
          <span class="text-sm">{{ t("home.continue.empty") }}</span>
        </div>
      </section>
      <!-- 推荐歌单 -->
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-on-surface">推荐歌单</h3>
          <SButton variant="text" size="tiny">
            查看全部
            <IconLucideChevronRight class="size-3.5" />
          </SButton>
        </div>
        <CoverList :items="recommendPlaylists" :virtual="false" :gap="16" />
      </section>
    </div>
  </div>
</template>
