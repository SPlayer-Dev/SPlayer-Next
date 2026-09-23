import { ipcMain } from "electron";
import type { AiModelSaveInput } from "@shared/types/ai";
import {
  listAiModels,
  removeAiModel,
  saveAiModel,
  setActiveAiModel,
} from "@main/services/ai/model";

/** 注册 AI 模型配置 IPC */
export const registerAiModelIpc = (): void => {
  ipcMain.handle("aiModel:list", listAiModels);
  ipcMain.handle("aiModel:save", (_event, input: AiModelSaveInput) => saveAiModel(input));
  ipcMain.handle("aiModel:remove", (_event, id: string) => removeAiModel(id));
  ipcMain.handle("aiModel:setActive", (_event, id: string | null) => setActiveAiModel(id));
};
