import { BrowserWindow, nativeTheme, ThumbarButton } from "electron";
import { sendToMain } from "@main/utils/broadcast";
import { loadThemedIcon } from "@main/utils/icon";
import { t } from "@main/utils/i18n";
import { thumbarLog } from "@main/utils/logger";

export interface Thumbar {
  clearThumbar(): void;
  updateThumbar(playing: boolean): void;
  updateLike(liked: boolean): void;
  refreshLocale(): void;
}

let thumbar: Thumbar | null = null;

const thumbarIcon = (name: string) => loadThemedIcon("thumbar", name);

// 创建缩略图工具栏
class ThumbarImpl implements Thumbar {
  private win: BrowserWindow;
  private like: ThumbarButton;
  private prev: ThumbarButton;
  private next: ThumbarButton;
  private play: ThumbarButton;
  private pause: ThumbarButton;
  private isPlaying: boolean = false;
  private isLiked: boolean = false;
  private onThemeUpdated: () => void;
  private onWindowShown: () => void;

  constructor(win: BrowserWindow) {
    this.win = win;
    this.like = {
      tooltip: t("addToLiked"),
      icon: thumbarIcon("unlike"),
      click: () => sendToMain("player:event", { type: "toggleLike" }),
    };
    this.prev = {
      tooltip: t("prev"),
      icon: thumbarIcon("prev"),
      click: () => sendToMain("player:event", { type: "prev" }),
    };
    this.next = {
      tooltip: t("next"),
      icon: thumbarIcon("next"),
      click: () => sendToMain("player:event", { type: "next" }),
    };
    this.play = {
      tooltip: t("play"),
      icon: thumbarIcon("play"),
      click: () => sendToMain("player:event", { type: "play" }),
    };
    this.pause = {
      tooltip: t("pause"),
      icon: thumbarIcon("pause"),
      click: () => sendToMain("player:event", { type: "pause" }),
    };
    // 初始化工具栏
    this.updateThumbar(false);
    // 监听主题变化，仅更新图标
    this.onThemeUpdated = () => {
      this.prev.icon = thumbarIcon("prev");
      this.next.icon = thumbarIcon("next");
      this.play.icon = thumbarIcon("play");
      this.pause.icon = thumbarIcon("pause");
      this.updateThumbar(this.isPlaying);
    };
    nativeTheme.on("updated", this.onThemeUpdated);
    // 窗口从托盘恢复显示后系统会清空任务栏按钮，需重新下发一次
    this.onWindowShown = () => this.updateThumbar(this.isPlaying);
    win.on("show", this.onWindowShown);
    // 窗口销毁时移除监听
    win.on("closed", () => {
      nativeTheme.removeListener("updated", this.onThemeUpdated);
      win.removeListener("show", this.onWindowShown);
    });
  }

  // 下发当前按钮组，喜欢按钮随状态切换图标与提示
  private renderButtons(): void {
    if (this.win.isDestroyed()) return;
    this.like.icon = thumbarIcon(this.isLiked ? "like" : "unlike");
    this.like.tooltip = t(this.isLiked ? "removeFromLiked" : "addToLiked");
    this.win.setThumbarButtons([
      this.prev,
      this.isPlaying ? this.pause : this.play,
      this.next,
      this.like,
    ]);
  }

  // 更新播放状态
  updateThumbar(playing: boolean): void {
    this.isPlaying = playing;
    this.renderButtons();
  }

  // 更新喜欢状态
  updateLike(liked: boolean): void {
    this.isLiked = liked;
    this.renderButtons();
  }

  // 语言变更后刷新 tooltip
  refreshLocale(): void {
    this.prev.tooltip = t("prev");
    this.next.tooltip = t("next");
    this.play.tooltip = t("play");
    this.pause.tooltip = t("pause");
    this.updateThumbar(this.isPlaying);
  }

  // 清除工具栏
  clearThumbar(): void {
    if (this.win.isDestroyed()) return;
    this.win.setThumbarButtons([]);
  }
}

/** 初始化缩略图工具栏 */
export const initThumbar = (win: BrowserWindow): Thumbar | null => {
  if (process.platform !== "win32") return null;
  try {
    thumbarLog.info("初始化缩略图工具栏");
    thumbar = new ThumbarImpl(win);
    return thumbar;
  } catch (error) {
    thumbarLog.error("初始化失败:", error);
    return null;
  }
};

/**
 * 获取缩略图工具栏实例
 */
export const getThumbar = (): Thumbar | null => thumbar;
