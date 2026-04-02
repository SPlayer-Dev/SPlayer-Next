import { ErrorCode, errorStrategies, MAX_RETRY } from "@shared/types/errors";
import type { ErrorStrategy } from "@shared/types/errors";
import { toast } from "@/composables/useToast";
import i18n from "@/i18n";

/** 重试计数器 */
const retryCounters = new Map<string, number>();

/** 获取错误码翻译 */
const getErrorMessage = (code: ErrorCode): string => {
  const key = `errors.${code}`;
  const { t, te } = i18n.global;
  return te(key) ? t(key) : t("errors.UNKNOWN");
};

/** 获取错误策略 */
const getStrategy = (code: string): ErrorStrategy => {
  return errorStrategies[code as ErrorCode] ?? "toast";
};

export interface HandleErrorOptions {
  /** 重试标识（用于去重计数） */
  retryKey?: string;
  /** 重试函数，返回 true 表示重试成功 */
  retryFn?: () => Promise<boolean>;
  /** 重试全部失败后的回调（如跳下一首） */
  onRetryFailed?: () => void;
}

/**
 * 统一处理 IPC 错误
 * @param error - 错误码
 * @param options - 重试选项
 */
export const handleError = async (error: string, options?: HandleErrorOptions): Promise<void> => {
  const strategy = getStrategy(error);

  switch (strategy) {
    case "silent":
      return;

    case "toast":
    case "reset":
      toast.error(getErrorMessage(error as ErrorCode));
      return;

    case "retry": {
      const { retryKey, retryFn, onRetryFailed } = options ?? {};
      if (!retryFn || !retryKey) {
        toast.error(getErrorMessage(error as ErrorCode));
        return;
      }
      const count = retryCounters.get(retryKey) ?? 0;
      if (count >= MAX_RETRY) {
        retryCounters.delete(retryKey);
        onRetryFailed?.();
        return;
      }
      retryCounters.set(retryKey, count + 1);
      const ok = await retryFn();
      if (ok) {
        retryCounters.delete(retryKey);
      } else {
        onRetryFailed?.();
      }
      return;
    }
  }
};
