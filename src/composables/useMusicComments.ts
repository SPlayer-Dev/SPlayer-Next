import type { Ref } from "vue";
import type { Track } from "@shared/types/player";
import type {
  CommentSource,
  CommentTab,
  MusicCommentItem,
  MusicCommentPage,
} from "@shared/types/comment";
import { toast } from "@/composables/useToast";
import { appendUniqueComments, hasNextCommentPage } from "@/utils/commentPagination";

const DEFAULT_LIMIT = 20;
const NETEASE_SOURCE_ID = "builtin:netease";

type CommentTabState = MusicCommentPage & {
  hasMore: boolean;
  loadingMore: boolean;
  initialError: string;
  appendError: string;
};

const createTabState = (): CommentTabState => ({
  list: [],
  total: 0,
  page: 0,
  limit: DEFAULT_LIMIT,
  hasMore: true,
  loadingMore: false,
  initialError: "",
  appendError: "",
});

const makeTrackKey = (track: Track): string =>
  `${track.source}\n${track.serverId ?? ""}\n${track.id}`;

const makeContextKey = (track: Track, source: string): string =>
  `${makeTrackKey(track)}\n${source}`;

/**
 * 歌曲评论数据加载 composable
 * @param trackRef - 当前曲目引用（独立页为冻结快照，全屏内嵌为 media.track）
 * @param scrollRef - 评论滚动容器
 */
export const useMusicComments = (
  trackRef: Ref<Track | null>,
  scrollRef: Ref<HTMLElement | null>,
) => {
  const { t } = useI18n();

  const sources = shallowRef<CommentSource[]>([]);
  const sourceId = ref("");
  const activeTab = ref<CommentTab>("hot");
  const loadingCount = ref(0);

  const pages = reactive<Record<CommentTab, CommentTabState>>({
    hot: createTabState(),
    new: createTabState(),
  });
  const requestTokens = reactive<Record<CommentTab, number>>({ hot: 0, new: 0 });

  const creatorComments = shallowRef<MusicCommentItem[]>([]);
  const creatorLoading = ref(false);
  const creatorError = ref("");

  let loadingEpoch = 0;
  let creatorEpoch = 0;
  let disposed = false;

  const sourceOptions = computed(() =>
    sources.value.map((source) => ({ value: source.id, label: source.name })),
  );
  const tabs = computed(() => [
    { key: "hot", label: `${t("comments.hot")} (${pages.hot.total})` },
    { key: "new", label: `${t("comments.new")} (${pages.new.total})` },
  ]);

  const loading = computed(() => loadingCount.value > 0);
  const page = computed(() => pages[activeTab.value]);
  const error = computed(() => page.value.initialError);
  const creatorIds = computed(() => new Set(creatorComments.value.map((comment) => comment.id)));
  const dedupedList = computed(() =>
    page.value.list.filter((item) => !creatorIds.value.has(item.id)),
  );

  /** 加载可用评论源，确保 sourceId 有效 */
  const loadSources = async (): Promise<void> => {
    const availableSources = await window.api.comments.sources();
    if (disposed) return;
    sources.value = availableSources;
    if (!sources.value.some((source) => source.id === sourceId.value)) {
      sourceId.value = sources.value[0]?.id ?? "";
    }
  };

  /** 重置分页与主创数据，作废所有进行中的请求 */
  const resetPages = (): void => {
    requestTokens.hot += 1;
    requestTokens.new += 1;
    creatorEpoch += 1;
    loadingEpoch += 1;
    loadingCount.value = 0;
    pages.hot = createTabState();
    pages.new = createTabState();
    creatorComments.value = [];
    creatorLoading.value = false;
    creatorError.value = "";
  };

  /**
   * 加载指定 Tab 的评论
   * @param type - 评论 Tab
   * @param pageNo - 页码
   * @param append - 是否追加到现有列表
   */
  const loadPage = async (type: CommentTab, pageNo = 1, append = false): Promise<void> => {
    const track = trackRef.value;
    if (!track || !sourceId.value) return;

    const token = requestTokens[type] + 1;
    requestTokens[type] = token;
    const contextKey = makeContextKey(track, sourceId.value);
    const epoch = loadingEpoch;

    if (append) {
      pages[type].loadingMore = true;
      pages[type].appendError = "";
    } else {
      loadingCount.value += 1;
      pages[type].initialError = "";
    }

    const isCurrentRequest = (): boolean => {
      const currentTrack = trackRef.value;
      return (
        !disposed &&
        requestTokens[type] === token &&
        loadingEpoch === epoch &&
        !!currentTrack &&
        makeContextKey(currentTrack, sourceId.value) === contextKey
      );
    };

    try {
      const result = await window.api.comments.get({
        sourceId: sourceId.value,
        track: toRaw(track),
        type,
        page: pageNo,
        limit: pages[type].limit,
      });
      if (!result.ok) throw new Error(result.error);
      if (!isCurrentRequest()) return;

      const previousCount = pages[type].list.length;
      const nextList = append
        ? appendUniqueComments(pages[type].list, result.data.list)
        : result.data.list;
      pages[type] = {
        ...result.data,
        list: nextList,
        hasMore:
          hasNextCommentPage(
            nextList.length,
            result.data.total,
            result.data.list.length,
            result.data.limit,
          ) && (!append || nextList.length > previousCount),
        loadingMore: false,
        initialError: "",
        appendError: "",
      };
    } catch (err) {
      if (!isCurrentRequest()) return;
      const message = err instanceof Error ? err.message : String(err);
      if (append) {
        pages[type].appendError = message;
      } else {
        pages[type].initialError = message;
        toast.error(message);
      }
    } finally {
      if (isCurrentRequest()) {
        if (append) {
          pages[type].loadingMore = false;
        } else {
          loadingCount.value = Math.max(0, loadingCount.value - 1);
        }
      }
    }
  };

  /** 加载当前 Tab 的下一页 */
  const loadMore = async (): Promise<void> => {
    const state = pages[activeTab.value];
    if (loading.value || state.loadingMore || !state.hasMore || state.page < 1) return;
    await loadPage(activeTab.value, state.page + 1, true);
  };

  /** 加载主创说评论（仅网易云内建源） */
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

  /** 刷新两组评论与主创说 */
  const refresh = async (): Promise<void> => {
    resetPages();
    await Promise.all([loadPage("hot"), loadPage("new"), loadCreator()]);
    await nextTick();
    scrollRef.value?.scrollTo({ top: 0 });
  };

  const setSource = (id: string): void => {
    sourceId.value = id;
  };

  const setTab = (key: string): void => {
    activeTab.value = key as CommentTab;
  };

  watch(trackRef, (next, previous) => {
    if (!next || (previous && makeTrackKey(next) === makeTrackKey(previous))) return;
    void refresh();
  });

  watch(sourceId, (next, previous) => {
    if (!next || !previous || next === previous) return;
    void refresh();
  });

  void loadSources().then(async () => {
    if (!disposed) await refresh();
  });

  onScopeDispose(() => {
    disposed = true;
    requestTokens.hot += 1;
    requestTokens.new += 1;
    creatorEpoch += 1;
    loadingEpoch += 1;
  });

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
    sourceOptions,
    tabs,
    creatorIds,
    dedupedList,
    error,
    loadSources,
    loadPage,
    loadMore,
    loadCreator,
    refresh,
    setSource,
    setTab,
  };
};
