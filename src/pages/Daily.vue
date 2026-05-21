<script setup lang="ts">
import { useDataStore } from "@/stores/data";
import SongList from "@/components/list/SongList.vue";
import * as player from "@/core/player";

const { t } = useI18n();
const data = useDataStore();

/** 首次进入且无缓存时显示加载态 */
const loading = ref(data.dailyRecommend.length === 0);

const handlePlayAll = (): void => {
  if (data.dailyRecommend.length === 0) return;
  player.playFrom(data.dailyRecommend, 0);
};

onMounted(async () => {
  await data.ensureDailyRecommend();
  loading.value = false;
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between mt-2 mb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-3xl font-bold text-on-surface">{{ t("daily.title") }}</h1>
          <span
            v-if="data.dailyRecommend.length > 0"
            class="text-sm text-on-surface-variant/50 flex items-center gap-1"
          >
            <IconLucideMusic class="size-3.5" />
            {{ t("common.totalSongs", { count: data.dailyRecommend.length }) }}
          </span>
        </div>
      </div>
      <SButton
        type="primary"
        variant="secondary"
        round
        :disabled="data.dailyRecommend.length === 0"
        @click="handlePlayAll"
      >
        <template #icon>
          <IconLucidePlay />
        </template>
        {{ t("common.playAll") }}
      </SButton>
    </div>
    <!-- 列表 -->
    <Transition name="fade" mode="out-in" :duration="150">
      <div v-if="data.dailyRecommend.length > 0" key="list" class="flex-1 min-h-0">
        <SongList :items="data.dailyRecommend" />
      </div>
      <div v-else key="empty" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideCalendarDays class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ loading ? t("common.loading") : t("daily.empty") }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>
