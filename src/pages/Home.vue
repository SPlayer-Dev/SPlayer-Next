<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { netease } from "@/apis/netease";
import { qqmusic } from "@/apis/qqmusic";
import { kugou } from "@/apis/kugou";
import type { Platform } from "@shared/types/platform";

const media = useMediaStore();

const platform = ref<Platform>("netease");
const loading = ref(false);
const errorMsg = ref("");
const rawSearch = ref<unknown>(null);
const rawLyric = ref<unknown>(null);
const picked = ref<unknown>(null);

const toJson = (v: unknown, n = 12000): string => {
  try {
    const s = JSON.stringify(v, null, 2);
    return s.length > n ? `${s.slice(0, n)}…` : s;
  } catch {
    return String(v);
  }
};

/** 各平台独立拉 search 原始返回 + 第一条 lyric 原始返回 */
const runMatch = async (): Promise<void> => {
  const track = media.track;
  if (!track) {
    errorMsg.value = "当前没有播放曲目";
    return;
  }
  loading.value = true;
  errorMsg.value = "";
  rawSearch.value = null;
  rawLyric.value = null;
  picked.value = null;

  const keyword = `${track.title} ${track.artists[0]?.name ?? ""}`.trim();

  try {
    if (platform.value === "netease") {
      const body = (await netease.search({ keywords: keyword, type: 1, limit: 25 })) as {
        result?: { songs?: { id: number }[] };
      };
      rawSearch.value = body;
      const first = body?.result?.songs?.[0];
      if (first) {
        picked.value = first;
        rawLyric.value = await netease.lyric_new({ id: String(first.id) });
      }
    } else if (platform.value === "qqmusic") {
      const body = (await qqmusic.search({ keywords: keyword, limit: 25 })) as {
        songs?: { id: string; name: string; artist: string; album: string; duration: number }[];
      };
      rawSearch.value = body;
      const first = body.songs?.[0];
      if (first) {
        picked.value = first;
        rawLyric.value = await qqmusic.lyric({
          id: first.id,
          name: first.name,
          artist: first.artist,
          album: first.album,
          duration: Math.floor((first.duration ?? 0) / 1000),
        });
      }
    } else if (platform.value === "kugou") {
      const body = (await kugou.search({ keywords: keyword, limit: 25 })) as {
        songs?: { hash: string; name: string; duration: number }[];
      };
      rawSearch.value = body;
      const first = body.songs?.[0];
      if (first) {
        picked.value = first;
        rawLyric.value = await kugou.lyric({
          hash: first.hash,
          name: first.name,
          duration: Math.floor((first.duration ?? 0) / 1000),
        });
      }
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col gap-4 p-8 max-w-3xl mx-auto w-full">
    <h2 class="text-lg font-semibold">歌词匹配测试</h2>

    <div class="rounded-xl border border-solid border-outline-variant/40 p-4 space-y-3">
      <div v-if="media.track" class="text-xs text-on-surface-variant">
        当前：{{ media.track.title }} —
        {{ media.track.artists.map((a) => a.name).join(" / ") }}
        <span v-if="media.track.album?.name"> · {{ media.track.album.name }}</span>
        <span v-if="media.track.duration"> · {{ Math.round(media.track.duration / 1000) }}s </span>
      </div>
      <div v-else class="text-xs text-on-surface-variant/60">暂无播放曲目</div>

      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-xs text-on-surface-variant">平台</span>
        <select
          v-model="platform"
          class="px-2 py-1.5 rounded-lg text-sm border border-solid border-outline-variant bg-surface-alt text-on-surface outline-none"
        >
          <option value="netease">Netease</option>
          <option value="qqmusic">QQMusic</option>
          <option value="kugou">Kugou</option>
        </select>
        <SButton
          type="primary"
          size="small"
          :loading="loading"
          :disabled="!media.track"
          @click="runMatch"
        >
          执行
        </SButton>
      </div>

      <div v-if="errorMsg" class="rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-500">
        {{ errorMsg }}
      </div>

      <details v-if="rawSearch" open class="text-xs">
        <summary class="cursor-pointer text-on-surface">search 原始返回</summary>
        <pre
          class="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-on-surface/5 p-2 font-mono text-[11px]"
          >{{ toJson(rawSearch) }}</pre
        >
      </details>

      <details v-if="picked" class="text-xs">
        <summary class="cursor-pointer text-on-surface">选中的第一条候选（lyric 参数来源）</summary>
        <pre
          class="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-on-surface/5 p-2 font-mono text-[11px]"
          >{{ toJson(picked) }}</pre
        >
      </details>

      <details v-if="rawLyric" open class="text-xs">
        <summary class="cursor-pointer text-on-surface">lyric 原始返回</summary>
        <pre
          class="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-on-surface/5 p-2 font-mono text-[11px]"
          >{{ toJson(rawLyric) }}</pre
        >
      </details>
    </div>
  </div>
</template>
