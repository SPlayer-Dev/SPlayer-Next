/**
 * OpenCC 中文简繁转换服务
 */

import { loadNativeModule } from "@main/utils/nativeLoader";
import { nativeLog } from "@main/utils/logger";
import type { CjkTransformMode } from "@shared/types/opencc";

type OpenccNative = typeof import("@splayer/opencc");

let native: OpenccNative | null = null;

/** 懒加载原生模块 */
const getNative = (): OpenccNative | null => {
  if (native) return native;
  native = loadNativeModule<OpenccNative>("opencc.node", "opencc");
  return native;
};

/**
 * 转换单个文本
 * @param text - 待转换文本
 * @param config - 转换模式
 * @returns 转换后的文本
 */
export const convertText = (text: string, config: CjkTransformMode): string => {
  if (!text || !config || config === "none") return text;
  const mod = getNative();
  if (!mod) return text;
  try {
    return mod.convert(text, config);
  } catch (error) {
    nativeLog.error("[OpenCC] 文本转换失败:", error);
    return text;
  }
};

/**
 * 批量转换文本列表
 * @param texts - 待转换文本数组
 * @param config - 转换模式
 * @returns 转换后的文本数组
 */
export const convertTexts = (texts: string[], config: CjkTransformMode): string[] => {
  if (!texts || texts.length === 0 || !config || config === "none") return texts;
  const mod = getNative();
  if (!mod) return texts;
  try {
    return mod.convertBatch(texts, config);
  } catch (error) {
    nativeLog.error("[OpenCC] 批量转换失败:", error);
    return texts;
  }
};
