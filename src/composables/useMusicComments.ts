import type { Ref } from "vue";
import type { Track } from "@shared/types/player";
import type {
  CommentSource,
  MusicCommentItem,
  MusicCommentPage,
} from "@shared/types/comment";
import { toast } from "@/composables/useToast";

const DEFAULT_LIMIT = 20;
const NETEASE_SOURCE_ID = "builtin:netease";

const makeContextKey = (trackId: string, source: string): string => `${trackId}\n${source}`;

/**
 * 歌曲评论数据加载 composable
 * 泛化自 MusicCommentsDialog，接受外部 trackRef 驱动加载
 * @param trackRef - 当前曲目引用（独立页为冻结快照，全屏内嵌为 media.track）
 */
export const useMusicComments = (
  trackRef: Ref<Track | null>,
  scrollRef: Ref<HTMLElement | null>,
) => {
  const { t } = useI18n();

  const sources = shallowRef<CommentSource[]>([]);
  const sourceId = ref("");
  const activeTab = ref<"hot" | "new">("hot");
  const loadingCount = ref(0);
  const error = ref("");

  const pages = reactive<Record<"hot" | "new", MusicCommentPage>>({
    hot: { list: [], total: 0, page: 1, limit: DEFAULT_LIMIT },
    new: { list: [], total: 0, page: 1, limit: DEFAULT_LIMIT },
  });
  const requestTokens = reactive<Record<"hot" | "new", number>>({ hot: 0, new: 0 });

  const creatorComments = shallowRef<MusicCommentItem[]>([]);
  const creatorLoading = ref(false);
  const creatorError = ref("");

  const loadingEpoch = 0;
  let creatorEpoch = 0;

  const sourceOptions = computed(() =>
    sources.value.map((source) => ({ value: source.id, label: source.name })),
  );
  const tabs = computed(() => [
    { key: "hot", label: `${t("comments.hot")} (${pages.hot.total})` },
    { key: "new", label: `${t("comments.new")} (${pages.new.total})` },
  ]);

  const loading = computed(() => loadingCount.value > 0);
  const page = computed(() => pages[activeTab.value]);
  const maxPage = computed(() =>
    Math.max(1, Math.ceil(page.value.total / Math.max(1, page.value.limit))),
  );
  const creatorIds = computed(() => new Set(creatorComments.value.map((c) => c.id)));
  const dedupedList = computed(() =>
    page.value.list.filter((item) => !creatorIds.value.has(item.id)),
  );

  /** 加载可用评论源，确保 sourceId 有效 */
  const loadSources = async (): Promise<void> => {
    sources.value = await window.api.comments.sources();
    if (!sources.value.some((source) => source.id === sourceId.value)) {
      sourceId.value = sources.value[0]?.id ?? "";
    }
  };

  /** 重置分页与主创数据，作废所有 in-flight 请求 */
  const resetPages = (): void => {
    requestTokens.hot += 1;
    requestTokens.new += 1;
    creatorEpoch += 1;
    pages.hot = { list: [], total: 0, page: 1, limit: DEFAULT_LIMIT };
    pages.new = { list: [], total: 0, page: 1, limit: DEFAULT_LIMIT };
    creatorComments.value = [];
  };

  /**
   * 加载指定 tab 的指定页评论
   * 竞态保护：token + contextKey + epoch，切歌/切源后旧响应丢弃
   */
  const loadPage = async (type: "hot" | "new", pageNo = 1): Promise<void> => {
    const track = trackRef.value;
    if (!track || !sourceId.value) return;
    const token = requestTokens[type] + 1;
    requestTokens[type] = token;
    const contextKey = makeContextKey(track.id, sourceId.value);
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
      });
      if (!result.ok) throw new Error(result.error);
      if (requestTokens[type] !== token) return;
      const currentTrack = trackRef.value;
      if (!currentTrack || makeContextKey(currentTrack.id, sourceId.value) !== contextKey) return;
      pages[type] = result.data;
    } catch (err) {
      if (requestTokens[type] !== token) return;
      error.value = err instanceof Error ? err.message : String(err);
      toast.error(error.value);
    } finally {
      if (epoch === loadingEpoch) loadingCount.value = Math.max(0, loadingCount.value - 1);
    }
  };

  /**
   * 加载主创说评论（仅网易云内建源）
   * 失败仅设 creatorError 不弹 toast；creatorEpoch 保护切歌作废
   */
  const loadCreator = async (): Promise<void> => {
    const track = trackRef.value;
    if (!track || sourceId.value !== NETEASE_SOURCE_ID) {
      creatorComments.value = [];
      creatorError.value = "";
      return;
    }
    const epoch = ++creatorEpoch;
    creatorLoading.value = true;
    creatorError.value = "";
    try {
      const result = await window.api.comments.creator({
        sourceId: sourceId.value,
        track: toRaw(track),
      });
      if (epoch !== creatorEpoch) return;
      if (!result.ok) throw new Error(result.error);
      creatorComments.value = result.data;
    } catch (err) {
      if (epoch !== creatorEpoch) return;
      creatorError.value = err instanceof Error ? err.message : String(err);
      creatorComments.value = [];
    } finally {
      if (epoch === creatorEpoch) creatorLoading.value = false;
    }
  };

  /** 刷新：重置分页 + 拉取两 tab + 主创说 + 滚动归零 */
  const refresh = async (): Promise<void> => {
    resetPages();
    await Promise.all([loadPage("hot"), loadPage("new")]);
    await loadCreator();
    await nextTick();
    scrollRef.value?.scrollTo({ top: 0 });
  };

  /** 翻页，delta 为 +1/-1 */
  const changePage = async (delta: number): Promise<void> => {
    const next = Math.min(maxPage.value, Math.max(1, page.value.page + delta));
    if (next === page.value.page) return;
    await loadPage(activeTab.value, next);
    await nextTick();
    scrollRef.value?.scrollTo({ top: 0 });
  };

  const setSource = (id: string): void => {
    sourceId.value = id;
  };

  const setTab = (key: string): void => {
    activeTab.value = key as "hot" | "new";
  };

  watch(trackRef, (next, prev) => {
    if (!next || next === prev) return;
    refresh().catch(() => {});
  });

  watch(sourceId, (next, prev) => {
    if (!next || !prev || next === prev) return;
    refresh().catch(() => {});
  });

  void loadSources().then(() => refresh());

  return {
    sources,
    sourceId,
    activeTab,
    pages,
    creatorComments,
    creatorLoading,
    creatorError,
    loading,
    page,
    maxPage,
    sourceOptions,
    tabs,
    creatorIds,
    dedupedList,
    error,
    loadSources,
    loadPage,
    loadCreator,
    refresh,
    changePage,
    setSource,
    setTab,
  };
};
