<script setup lang="ts">
import type { CommentSource, CommentTab, MusicCommentPage } from "@shared/types/comment";
import { useStatusStore } from "@/stores/status";
import { toast } from "@/composables/useToast";
import { formatDate } from "@/utils/time";
import IconLucideThumbsUp from "~icons/lucide/thumbs-up";

const { t } = useI18n();
const status = useStatusStore();

const sources = shallowRef<CommentSource[]>([]);
const sourceId = ref("");
const activeTab = ref<"hot" | "new">("hot");
const loadingCount = ref(0);
const error = ref("");
const listScrollRef = ref<HTMLElement | null>(null);
let loadingEpoch = 0;
let suppressSourceRefresh = false;
const pages = reactive<Record<"hot" | "new", MusicCommentPage>>({
  hot: { list: [], total: 0, page: 1, limit: 20 },
  new: { list: [], total: 0, page: 1, limit: 20 },
});
const pageCursors = reactive<Record<"hot" | "new", Record<number, string>>>({
  hot: { 1: "" },
  new: { 1: "" },
});
const requestTokens = reactive<Record<"hot" | "new", number>>({
  hot: 0,
  new: 0,
});

const sourceOptions = computed(() =>
  sources.value.map((source) => ({ value: source.id, label: source.name })),
);
const selectedSource = computed(() => sources.value.find((source) => source.id === sourceId.value));
const supportedTabs = computed<CommentTab[]>(() => selectedSource.value?.tabs ?? ["hot", "new"]);
const tabs = computed(() =>
  supportedTabs.value.map((key) => ({
    key,
    label: `${t(`comments.${key}`)} (${pages[key].total})`,
  })),
);

const loading = computed(() => loadingCount.value > 0);
const page = computed(() => pages[activeTab.value]);
const maxPage = computed(() =>
  Math.max(1, Math.ceil(page.value.total / Math.max(1, page.value.limit))),
);

const makeContextKey = (track: { id: string; extId?: string; source: string }, source: string) =>
  `${track.source}\n${track.id}\n${track.extId ?? ""}\n${source}`;

const loadSources = async (): Promise<void> => {
  sources.value = await window.api.comments.sources();
  const track = status.commentsTrack;
  const preferred = sources.value.find((source) => source.platform === track?.source);
  const nextSource =
    preferred?.id ||
    (sources.value.some((source) => source.id === sourceId.value) ? sourceId.value : "") ||
    sources.value[0]?.id ||
    "";
  suppressSourceRefresh = true;
  sourceId.value = nextSource;
  await nextTick();
  suppressSourceRefresh = false;
};

const resetPages = (): void => {
  requestTokens.hot += 1;
  requestTokens.new += 1;
  pages.hot = { list: [], total: 0, page: 1, limit: 20 };
  pages.new = { list: [], total: 0, page: 1, limit: 20 };
  pageCursors.hot = { 1: "" };
  pageCursors.new = { 1: "" };
};

const loadPage = async (type: "hot" | "new", pageNo = 1): Promise<void> => {
  const track = status.commentsTrack;
  if (!track || !sourceId.value) return;
  const token = requestTokens[type] + 1;
  requestTokens[type] = token;
  const contextKey = makeContextKey(track, sourceId.value);
  const epoch = loadingEpoch;
  loadingCount.value += 1;
  error.value = "";
  try {
    const result = await window.api.comments.get({
      sourceId: sourceId.value,
      track: toRaw(track),
      type,
      page: pageNo,
      limit: pages[type].limit,
      cursor: pageCursors[type][pageNo],
    });
    if (!result.ok) throw new Error(result.error);
    if (!status.commentsOpen || requestTokens[type] !== token) return;
    const currentTrack = status.commentsTrack;
    if (!currentTrack || makeContextKey(currentTrack, sourceId.value) !== contextKey) return;
    pages[type] = result.data;
    if (result.data.nextCursor) pageCursors[type][pageNo + 1] = result.data.nextCursor;
  } catch (err) {
    if (!status.commentsOpen || requestTokens[type] !== token) return;
    error.value = err instanceof Error ? err.message : String(err);
    toast.error(error.value);
  } finally {
    if (epoch === loadingEpoch) loadingCount.value = Math.max(0, loadingCount.value - 1);
  }
};

const refresh = async (): Promise<void> => {
  resetPages();
  if (!supportedTabs.value.includes(activeTab.value)) activeTab.value = supportedTabs.value[0];
  await Promise.all(supportedTabs.value.map((type) => loadPage(type)));
  await nextTick();
  listScrollRef.value?.scrollTo({ top: 0 });
};

const changePage = async (delta: number): Promise<void> => {
  const next = Math.min(maxPage.value, Math.max(1, page.value.page + delta));
  if (next === page.value.page) return;
  await loadPage(activeTab.value, next);
  await nextTick();
  listScrollRef.value?.scrollTo({ top: 0 });
};

watch(
  () => status.commentsOpen,
  async (open) => {
    if (!open) {
      loadingEpoch += 1;
      loadingCount.value = 0;
      requestTokens.hot += 1;
      requestTokens.new += 1;
      return;
    }
    await loadSources();
    await refresh();
  },
);

watch(sourceId, (next, prev) => {
  if (suppressSourceRefresh || !status.commentsOpen || !next || next === prev) return;
  refresh().catch(() => {});
});

watch(activeTab, async (next, prev) => {
  if (!status.commentsOpen || next === prev) return;
  await nextTick();
  listScrollRef.value?.scrollTo({ top: 0 });
});
</script>

<template>
  <SDialog
    v-model:open="status.commentsOpen"
    :title="
      status.commentsTrack
        ? t('comments.title', { name: status.commentsTrack.title })
        : t('comments.name')
    "
    width="min(860px, 92vw)"
    height="min(720px, 84vh)"
    destroy-on-close
  >
    <div class="flex h-full min-h-0 flex-col gap-3 px-5 pb-4">
      <div class="flex shrink-0 items-center gap-3">
        <div class="min-w-0 flex-1">
          <STabs v-model="activeTab" :tabs="tabs" type="bar" size="medium" />
        </div>
        <SButton variant="ghost" circle size="small" :loading="loading" @click="refresh">
          <template #icon><IconLucideRefreshCw /></template>
        </SButton>
        <div class="w-28 shrink-0">
          <SSelect
            v-model="sourceId"
            :options="sourceOptions"
            :disabled="sources.length === 0 || loading"
          />
        </div>
      </div>

      <div
        v-if="!sources.length"
        class="flex flex-1 items-center justify-center text-on-surface-variant"
      >
        <div class="text-center text-on-surface-variant/60">
          <IconLucideMessageCircleOff class="mx-auto mb-4 size-14 opacity-30" />
          <div class="text-sm">{{ t("comments.noSource") }}</div>
        </div>
      </div>
      <div
        v-else-if="error && page.list.length === 0"
        class="flex flex-1 flex-col items-center justify-center gap-3"
      >
        <div class="text-sm text-on-surface-variant">{{ error }}</div>
        <SButton variant="outline" @click="loadPage(activeTab, page.page)">
          {{ t("common.retry") }}
        </SButton>
      </div>
      <div
        v-else-if="page.list.length === 0 && loading"
        class="flex flex-1 items-center justify-center text-on-surface-variant"
      >
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="mx-auto mb-4 block text-4xl text-primary/70" />
          <div class="text-sm">{{ t("comments.loading") }}</div>
        </div>
      </div>
      <div
        v-else-if="page.list.length === 0"
        class="flex flex-1 items-center justify-center text-on-surface-variant"
      >
        <div class="text-center text-on-surface-variant/60">
          <IconLucideMessageCircleOff class="mx-auto mb-4 size-14 opacity-30" />
          <div class="text-sm">{{ t("comments.empty") }}</div>
        </div>
      </div>
      <div v-else ref="listScrollRef" class="min-h-0 flex-1 overflow-y-auto pr-1">
        <div class="space-y-1.5">
          <SCard v-for="item in page.list" :key="item.id" size="small" radius="lg">
            <div class="flex gap-3">
              <SImg
                v-if="item.avatar"
                :src="item.avatar"
                class="h-9 w-9 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                alt=""
              />
              <div v-else class="h-9 w-9 shrink-0 rounded-full bg-on-surface/8" />
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium">{{ item.userName }}</div>
                    <div class="mt-0.5 flex gap-2 text-xs text-on-surface-variant">
                      <span v-if="item.time">{{ formatDate(item.time) }}</span>
                      <span v-if="item.location">
                        {{ t("comments.location", { location: item.location }) }}
                      </span>
                    </div>
                  </div>
                  <div
                    v-if="item.likedCount != null"
                    class="flex shrink-0 items-center gap-1 text-xs tabular-nums text-on-surface-variant"
                  >
                    <IconLucideThumbsUp class="size-3.5" />
                    <span>{{ item.likedCount }}</span>
                  </div>
                </div>
                <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                  {{ item.text }}
                </p>
                <div
                  v-if="item.images?.length"
                  class="mt-2 grid w-fit max-w-full grid-cols-3 gap-1.5"
                >
                  <SImg
                    v-for="(image, index) in item.images"
                    :key="image"
                    :src="image"
                    :alt="`${item.userName} ${index + 1}`"
                    :class="[
                      'aspect-square max-w-full rounded-lg ring-1 ring-black/10 dark:ring-white/10',
                      item.images.length === 1 ? 'w-48' : 'w-24',
                    ]"
                  />
                </div>
                <div v-if="item.reply?.length" class="mt-2 rounded-md bg-on-surface/5 px-3 py-2">
                  <div
                    v-for="reply in item.reply"
                    :key="reply.id"
                    class="text-xs leading-5 text-on-surface-variant"
                  >
                    <span class="font-medium text-on-surface">{{ reply.userName }}：</span>
                    {{ reply.text }}
                  </div>
                </div>
              </div>
            </div>
          </SCard>
        </div>
      </div>

      <div
        v-if="sources.length"
        class="flex shrink-0 items-center justify-between text-xs text-on-surface-variant"
      >
        <span>{{ t("comments.page", { page: page.page, total: maxPage }) }}</span>
        <div class="flex gap-2">
          <SButton
            size="small"
            variant="secondary"
            :disabled="page.page <= 1 || loading"
            @click="changePage(-1)"
          >
            {{ t("common.prev") }}
          </SButton>
          <SButton
            size="small"
            variant="secondary"
            :disabled="page.page >= maxPage || loading"
            @click="changePage(1)"
          >
            {{ t("common.next") }}
          </SButton>
        </div>
      </div>
    </div>
  </SDialog>
</template>
