<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { openExternal } from "@/utils/url";

const media = useMediaStore();
</script>

<template>
  <div
    v-if="media.lyricAuthors.length > 0"
    class="w-full flex flex-wrap items-center justify-start text-left text-[max(0.5em,10px)]"
  >
    <span class="text-cover/40 select-none">{{ $t("player.lyricCredit") }}</span>
    <template v-for="(author, idx) in media.lyricAuthors" :key="author">
      <span v-if="idx > 0" class="mx-0.5 text-cover/30">,</span>
      <span
        class="ml-1 px-1.5 py-0.5 rounded-md cursor-pointer text-cover/50 transition-all duration-200 hover:text-cover hover:bg-cover/14 active:scale-95"
        @click.stop="openExternal(`https://github.com/${author}`)"
      >
        {{ "@" + author }}
      </span>
    </template>
  </div>
</template>
