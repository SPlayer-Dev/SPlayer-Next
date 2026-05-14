import { ErrorCode } from "@shared/types/errors";
import { toast } from "@/composables/useToast";
import { dialog } from "@/composables/useDialog";
import i18n from "@/i18n";

/** 静默错误码（用户主动取消等，不需要提示） */
const SILENT_ERRORS = new Set<string>([
  ErrorCode.FILE_NOT_SELECTED,
  ErrorCode.SCAN_DIR_NOT_SELECTED,
]);

/** 可通过跳曲解决的错误（单曲级别，非全局性） */
const SKIPPABLE_ERRORS = new Set<string>([
  ErrorCode.FILE_NOT_FOUND,
  ErrorCode.FILE_NO_AUDIO_STREAM,
  ErrorCode.FILE_DECODE_ERROR,
  ErrorCode.NETWORK_ERROR,
  ErrorCode.NETWORK_TIMEOUT,
  ErrorCode.URL_RESOLVE_FAILED,
  ErrorCode.NO_PLUGIN_AVAILABLE,
]);

/** 需要用 dialog 强提示的严重错误（阻断性，用户必须介入） */
const CRITICAL_ERRORS = new Set<string>([ErrorCode.DEVICE_NOT_FOUND, ErrorCode.DEVICE_INIT_FAILED]);

/** 同一严重错误同时只弹一次，避免叠加 */
const pendingCritical = new Set<string>();

/** 是否为可通过跳曲解决的错误 */
export const isSkippableError = (code: string): boolean => SKIPPABLE_ERRORS.has(code);

/** 统一处理错误码：静默的忽略，严重的弹 dialog，其他 toast 提示 */
export const handleError = (error: string): void => {
  if (SILENT_ERRORS.has(error)) return;
  const { t, te } = i18n.global;
  const key = `errors.${error}`;
  const message = te(key) ? t(key) : t("errors.UNKNOWN");
  if (CRITICAL_ERRORS.has(error)) {
    if (pendingCritical.has(error)) return;
    pendingCritical.add(error);
    // 设备类错误补充一段操作提示
    const isDeviceError =
      error === ErrorCode.DEVICE_NOT_FOUND || error === ErrorCode.DEVICE_INIT_FAILED;
    const hint = isDeviceError ? t("errors.deviceHint") : "";
    dialog
      .alert({
        title: t("errors.dialogTitle"),
        content: hint ? `${message}\n\n${hint}` : message,
        type: "error",
      })
      .finally(() => pendingCritical.delete(error));
    return;
  }
  toast.error(message);
};
