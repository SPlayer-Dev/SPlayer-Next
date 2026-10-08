import type { UpdateEvent, UpdateState } from "@shared/types/update";
import { toast } from "@/composables/useToast";
import i18n from "@/i18n";

const { t } = i18n.global;

export const useUpdateStore = defineStore("update", () => {
  const snapshot = shallowRef<UpdateState | null>(null);
  const dialogOpen = ref(false);
  const phase = computed(() => snapshot.value?.phase ?? "idle");
  const meta = computed(() => snapshot.value?.meta ?? null);
  const percent = computed(() => snapshot.value?.percent ?? 0);
  const mode = computed(() => snapshot.value?.mode ?? "external");
  const canInstall = computed(() => mode.value === "inApp");
  const errorSource = computed(() => snapshot.value?.error?.source);
  const hasUpdate = computed(() => meta.value !== null);
  let lastNotification = -1;

  /**
   * 忽略迟到的拉取结果，主进程快照是唯一状态来源
   * @param next - IPC 响应或事件携带的完整快照
   */
  const applyState = (next: UpdateState): void => {
    if (snapshot.value && next.revision < snapshot.value.revision) return;
    snapshot.value = next;
    if (!next.meta) dialogOpen.value = false;
  };

  /**
   * 同步状态并按版本去重提示，避免 IPC 响应和事件交错时重复通知
   * @param event - 主进程发布的状态和提示信息
   */
  const handleEvent = (event: UpdateEvent): void => {
    if (snapshot.value && event.state.revision < snapshot.value.revision) return;
    applyState(event.state);
    if (event.state.revision <= lastNotification || !event.notification) return;
    lastNotification = event.state.revision;
    if (event.notification === "available") dialogOpen.value = true;
    if (event.notification === "downloaded") toast.success(t("update.readyToast"));
    if (event.notification === "upToDate" && event.manual) toast.success(t("update.upToDate"));
    if (event.notification === "error" && event.manual) toast.error(t("update.failed"));
  };

  const unsubscribe = window.api.update.onEvent(handleEvent);
  onScopeDispose(unsubscribe);
  void window.api.update
    .getState()
    .then(async (state) => {
      applyState(state);
      if (phase.value === "idle" && mode.value !== "store")
        applyState(await window.api.update.check(false));
    })
    .catch(console.warn);

  /** 检查入口统一处理已有更新和商店安装形式。 */
  const checkManually = (): void => {
    if (mode.value === "store") {
      void window.api.update.openDownloadPage();
    } else if (hasUpdate.value && errorSource.value !== "download") {
      dialogOpen.value = true;
    } else {
      void window.api.update
        .check(true)
        .then(applyState)
        .catch(() => toast.error(t("update.failed")));
    }
  };
  /** 下载结果由主进程确认，不提前把界面切到下载中 */
  const download = (): void => {
    void window.api.update
      .download()
      .then(applyState)
      .catch(() => toast.error(t("update.failed")));
  };
  /** 安装失败保留有效包，由主进程决定是否允许重试 */
  const install = (): void => {
    void window.api.update
      .install()
      .then(applyState)
      .catch(() => toast.error(t("update.failed")));
  };
  const openDownloadPage = (): void => void window.api.update.openDownloadPage();
  const openDialog = (): void => {
    dialogOpen.value = true;
  };

  return {
    phase,
    meta,
    percent,
    mode,
    canInstall,
    errorSource,
    dialogOpen,
    hasUpdate,
    checkManually,
    download,
    install,
    openDownloadPage,
    openDialog,
  };
});
