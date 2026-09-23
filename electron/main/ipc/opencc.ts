/**
 * OpenCC 中文简繁转换 IPC
 */

import { ipcMain } from "electron";
import { convertText, convertTexts } from "@main/services/opencc";
import type { CjkTransformMode } from "@shared/types/opencc";

export const registerOpenccIpc = (): void => {
  ipcMain.handle("opencc:convert", (_evt, text: string, config: CjkTransformMode): string => {
    return convertText(text, config);
  });

  ipcMain.handle(
    "opencc:convertBatch",
    (_evt, texts: string[], config: CjkTransformMode): string[] => {
      return convertTexts(texts, config);
    },
  );
};
