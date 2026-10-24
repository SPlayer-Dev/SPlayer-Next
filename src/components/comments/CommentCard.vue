<script setup lang="ts">
import type { MusicCommentItem } from "@shared/types/comment";
import type { CommentDensity } from "@shared/types/settings";
import { formatDate } from "@/utils/time";

interface Props {
  /** 评论数据 */
  item: MusicCommentItem;
  /** 是否显示主创徽章 */
  creator?: boolean;
  /** 评论卡片密度 */
  density?: CommentDensity;
  /** 是否使用全屏播放器配色 */
  cover?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  creator: false,
  density: "standard",
  cover: false,
});

/** 按密度返回卡片与文字尺寸 */
const densityClasses = computed(() => {
  switch (props.density) {
    case "compact":
      return {
        card: "rounded-lg px-2.5 py-2",
        row: "gap-2",
        avatar: "h-8 w-8",
        name: "text-[13px]",
        meta: "text-[11px]",
        body: "mt-1.5 text-[13px] leading-5",
        reply: "mt-1.5 rounded-md px-2.5 py-1.5",
        replyText: "text-[11px] leading-5",
        like: "text-[11px]",
        likeIcon: "size-3",
      };
    case "comfortable":
      return {
        card: "rounded-2xl px-4 py-3.5",
        row: "gap-3.5",
        avatar: "h-10 w-10",
        name: "text-[15px]",
        meta: "text-[13px]",
        body: "mt-2.5 text-[15px] leading-7",
        reply: "mt-2.5 rounded-lg px-3 py-2.5",
        replyText: "text-xs leading-5",
        like: "text-[13px]",
        likeIcon: "size-4",
      };
    default:
      return {
        card: "rounded-xl px-3 py-2.5",
        row: "gap-3",
        avatar: "h-9 w-9",
        name: "text-sm",
        meta: "text-xs",
        body: "mt-2 text-sm leading-6",
        reply: "mt-2 rounded-lg px-3 py-2",
        replyText: "text-xs leading-5",
        like: "text-xs",
        likeIcon: "size-3.5",
      };
  }
});
</script>

<template>
  <div
    class="border border-solid transition-colors duration-150"
    :class="[
      cover
        ? 'border-cover/12 bg-gradient-to-br from-cover/10 via-cover/6 to-cover/3 ring-1 ring-cover/5 ring-inset hover:border-cover/20 hover:from-cover/14 hover:via-cover/8'
        : 'border-primary/20 bg-surface-panel',
      densityClasses.card,
    ]"
  >
    <div class="flex" :class="densityClasses.row">
      <SImg
        v-if="item.avatar"
        :src="item.avatar"
        class="shrink-0 rounded-full ring-1"
        :class="[
          densityClasses.avatar,
          cover ? 'ring-cover/15' : 'ring-black/10 dark:ring-white/10',
        ]"
        alt=""
      />
      <div
        v-else
        class="shrink-0 rounded-full"
        :class="[densityClasses.avatar, cover ? 'bg-cover/10' : 'bg-on-surface/8']"
      />
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="truncate font-medium" :class="densityClasses.name">
                {{ item.userName }}
              </span>
              <STag
                v-if="creator"
                :type="cover ? 'cover' : 'primary'"
                variant="soft"
                size="tiny"
                round
              >
                {{ item.creatorName ?? $t("comments.creatorBadge") }}
              </STag>
            </div>
            <div
              class="mt-0.5 flex gap-2"
              :class="[densityClasses.meta, cover ? 'text-cover/50' : 'text-on-surface-variant']"
            >
              <span v-if="item.time">{{ formatDate(item.time) }}</span>
              <span v-if="item.location">
                {{ $t("comments.location", { location: item.location }) }}
              </span>
            </div>
          </div>
          <div
            v-if="item.likedCount != null"
            class="flex shrink-0 items-center gap-1 tabular-nums"
            :class="[densityClasses.like, cover ? 'text-cover/50' : 'text-on-surface-variant']"
          >
            <IconLucideThumbsUp :class="densityClasses.likeIcon" />
            <span>{{ item.likedCount }}</span>
          </div>
        </div>
        <p class="whitespace-pre-wrap break-words" :class="densityClasses.body">
          {{ item.text }}
        </p>
        <div
          v-if="item.reply?.length"
          :class="[densityClasses.reply, cover ? 'bg-cover/7' : 'bg-on-surface/5']"
        >
          <div
            v-for="reply in item.reply"
            :key="reply.id"
            class="break-words"
            :class="[densityClasses.replyText, cover ? 'text-cover/60' : 'text-on-surface-variant']"
          >
            <span class="font-medium" :class="cover ? 'text-cover/85' : 'text-on-surface'">
              {{ reply.userName }}：
            </span>
            {{ reply.text }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
