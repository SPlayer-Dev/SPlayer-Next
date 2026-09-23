import type { UpdateEvent, UpdateMeta, UpdatePhase } from "@shared/types/update";
import { toast } from "@/composables/useToast";
import i18n from "@/i18n";

const { t } = i18n.global;

/** 更新错误来源，直接由共享 UpdateEvent 的 error 变体提取 */
export type UpdateErrorSource = Extract<UpdateEvent, { type: "error" }>["source"];

export const useUpdateStore = defineStore("update", () => {
  /** 当前阶段 */
  const phase = ref<UpdatePhase>("idle");
  /** 更新信息（版本 / 日志 / 日期 / 大小） */
  const meta = ref<UpdateMeta | null>(null);
  /** 下载进度 0–100 */
  const percent = ref(0);
  /** 当前平台是否支持应用内安装 */
  const canInstall = ref(false);
  /** 更新弹窗开关 */
  const dialogOpen = ref(false);
  /** 最近一次发生错误时的错误来源 */
  const errorSource = ref<UpdateErrorSource | null>(null);

  /** 是否有可用更新（驱动顶栏图标） */
  const hasUpdate = computed(
    () => meta.value !== null && ["available", "downloading", "downloaded"].includes(phase.value),
  );

  const handleEvent = (event: UpdateEvent): void => {
    switch (event.type) {
      case "invalidated":
        phase.value = "idle";
        meta.value = null;
        percent.value = 0;
        canInstall.value = false;
        dialogOpen.value = false;
        errorSource.value = null;
        break;
      case "checking":
        // 处于下载中或已就绪状态时，同通道检查不得冲掉当前状态；其余状态清空陈旧元信息并进入 checking
        if (phase.value !== "downloading" && phase.value !== "downloaded") {
          phase.value = "checking";
          meta.value = null;
          percent.value = 0;
          canInstall.value = false;
          errorSource.value = null;
        }
        break;
      case "available":
        phase.value = "available";
        meta.value = event.meta;
        canInstall.value = event.canInstall;
        percent.value = 0;
        dialogOpen.value = true;
        errorSource.value = null;
        break;
      case "notAvailable":
        phase.value = "upToDate";
        meta.value = null;
        percent.value = 0;
        canInstall.value = false;
        dialogOpen.value = false;
        errorSource.value = null;
        if (event.manual) toast.success(t("update.upToDate"));
        break;
      case "downloading":
        phase.value = "downloading";
        percent.value = 0;
        errorSource.value = null;
        break;
      case "downloadRejected": {
        const reasonKey =
          event.reason === "busy"
            ? "update.downloadBusy"
            : event.reason === "checking"
              ? "update.downloadChecking"
              : "update.downloadUnavailable";
        toast.warning(t(reasonKey));
        break;
      }
      case "progress":
        phase.value = "downloading";
        percent.value = event.percent;
        break;
      case "downloaded":
        phase.value = "downloaded";
        meta.value = event.meta;
        canInstall.value = true;
        errorSource.value = null;
        toast.success(t("update.readyToast"));
        break;
      case "error":
        phase.value = "error";
        errorSource.value = event.source;
        if (event.manual) toast.error(t("update.failed"));
        break;
    }
  };

  // 订阅主进程推送的更新事件
  const unsubscribe = window.api.update.onEvent(handleEvent);
  onScopeDispose(unsubscribe);
  // 触发启动检查
  void window.api.update.check(false);

  /** 手动检查更新 */
  const checkManually = (): void => {
    // 若已下载就绪但在安装阶段失败，且安装包与资格仍有效，直接重新打开弹窗供重试安装，避免发起已被主进程抑制的检查导致界面停滞在 checking
    if (
      phase.value === "error" &&
      errorSource.value === "install" &&
      meta.value !== null &&
      canInstall.value
    ) {
      dialogOpen.value = true;
      return;
    }

    if (phase.value !== "downloading" && phase.value !== "downloaded") {
      phase.value = "checking";
      meta.value = null;
      percent.value = 0;
      canInstall.value = false;
      errorSource.value = null;
    }
    void window.api.update.check(true);
  };

  /** 下载更新 */
  const download = (): void => {
    void window.api.update.download();
  };

  /** 退出并安装 */
  const install = (): void => {
    void window.api.update.install();
  };

  /** 打开 Releases 下载页（mac） */
  const openDownloadPage = (): void => void window.api.update.openDownloadPage();

  /** 打开更新弹窗 */
  const openDialog = (): void => {
    if (!meta.value) return;
    dialogOpen.value = true;
  };

  /** 重试当前失败的操作 */
  const retry = (): void => {
    if (phase.value !== "error") return;
    if (errorSource.value === "check") {
      checkManually();
    } else if (errorSource.value === "download") {
      if (meta.value && canInstall.value) {
        download();
      } else {
        checkManually();
      }
    } else if (errorSource.value === "install") {
      if (meta.value && canInstall.value) {
        install();
      }
    } else {
      checkManually();
    }
  };

  return {
    phase,
    meta,
    percent,
    canInstall,
    dialogOpen,
    errorSource,
    hasUpdate,
    checkManually,
    download,
    install,
    openDownloadPage,
    openDialog,
    retry,
    handleEvent,
  };
});
