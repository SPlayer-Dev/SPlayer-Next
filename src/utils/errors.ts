import { ErrorCode } from "@shared/types/errors";
import { toast } from "@/composables/useToast";
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
]);

/** 是否为可通过跳曲解决的错误 */
export const isSkippableError = (code: string): boolean => SKIPPABLE_ERRORS.has(code);

/** 统一处理错误码：静默的忽略，其他 toast 提示 */
export const handleError = (error: string): void => {
  if (SILENT_ERRORS.has(error)) return;
  const key = `errors.${error}`;
  const { t, te } = i18n.global;
  toast.error(te(key) ? t(key) : t("errors.UNKNOWN"));
};
