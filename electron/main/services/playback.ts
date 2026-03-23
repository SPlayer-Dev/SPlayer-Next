import { broadcast } from "../utils/broadcast";
import type { Track } from "@shared/types/player";
import type { RepeatMode, ShuffleMode } from "@shared/types/playback";
import { shuffleArray } from "../utils/helper";

/**
 * 播放控制服务
 * 管理播放队列、循环模式、随机模式、上下首逻辑
 *
 * 洗牌策略：
 * - 开启随机时，备份原始队列顺序，打乱当前队列（当前播放的歌移到首位）
 * - 关闭随机时，恢复原始顺序，定位到当前播放的歌
 */
class PlaybackService {
  /** 当前播放队列（随机模式下是打乱后的顺序） */
  private queue: Track[] = [];
  /** 原始队列顺序备份（随机模式开启时保存，关闭时恢复） */
  private originalQueue: Track[] | null = null;
  private currentIndex = -1;
  private repeatMode: RepeatMode = "off";
  private shuffleMode: ShuffleMode = "off";
  /** 加载歌曲回调 */
  private loadTrack: ((path: string) => Promise<void>) | null = null;
  /** 防止 onTrackEnded 重入 */
  private isTransitioning = false;

  /** 注册加载回调 */
  onLoadTrack(handler: (path: string) => Promise<void>): void {
    this.loadTrack = handler;
  }

  /** 设置队列并从指定位置播放 */
  async playFrom(items: Track[], startIndex = 0): Promise<void> {
    if (items.length === 0) return;
    this.queue = [...items];
    this.originalQueue = null;
    this.currentIndex = Math.max(0, Math.min(startIndex, items.length - 1));

    // 如果当前是随机模式，立即洗牌
    if (this.shuffleMode === "on") {
      this.applyShuffle();
    }

    this.broadcastQueueChanged();
    await this.loadCurrent();
  }

  /** 下一首 */
  async next(): Promise<void> {
    if (this.queue.length === 0) return;

    if (this.currentIndex >= this.queue.length - 1) {
      // 到末尾
      if (this.repeatMode === "list") {
        // 随机 + 列表循环：重新洗牌再从头开始
        if (this.shuffleMode === "on") {
          this.applyShuffle();
        }
        this.currentIndex = 0;
      } else {
        this.broadcastQueueEnded();
        return;
      }
    } else {
      this.currentIndex++;
    }

    this.broadcastQueueChanged();
    await this.loadCurrent();
  }

  /** 上一首 */
  async prev(): Promise<void> {
    if (this.queue.length === 0) return;
    this.currentIndex = this.currentIndex > 0 ? this.currentIndex - 1 : this.queue.length - 1;
    this.broadcastQueueChanged();
    await this.loadCurrent();
  }

  /** 歌曲播放结束，自动决定下一步 */
  async onTrackEnded(): Promise<void> {
    if (this.queue.length === 0) return;
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    try {
      if (this.repeatMode === "one") {
        await this.loadCurrent();
      } else {
        await this.next();
      }
    } finally {
      this.isTransitioning = false;
    }
  }

  /** 设置循环模式 */
  setRepeatMode(mode: RepeatMode): void {
    this.repeatMode = mode;
    broadcast("playback:event", { type: "repeat:changed", data: { mode } });
  }

  /** 获取循环模式 */
  getRepeatMode(): RepeatMode {
    return this.repeatMode;
  }

  /** 设置随机模式 */
  setShuffleMode(mode: ShuffleMode): void {
    if (this.shuffleMode === mode) return;
    this.shuffleMode = mode;

    if (mode === "on") {
      this.applyShuffle();
    } else {
      this.restoreOriginalOrder();
    }

    this.broadcastQueueChanged();
    broadcast("playback:event", { type: "shuffle:changed", data: { mode } });
  }

  /** 获取随机模式 */
  getShuffleMode(): ShuffleMode {
    return this.shuffleMode;
  }

  /** 获取队列长度 */
  getQueueLength(): number {
    return this.queue.length;
  }

  /** 获取当前播放索引 */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /** 获取当前队列项 */
  getCurrentItem(): Track | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.queue.length) return null;
    return this.queue[this.currentIndex];
  }

  /** 分页获取队列 */
  getQueuePage(offset: number, limit: number): { items: Track[]; total: number; currentIndex: number } {
    return {
      items: this.queue.slice(offset, offset + limit),
      total: this.queue.length,
      currentIndex: this.currentIndex,
    };
  }

  /** 插入到队列 */
  insert(item: Track, afterIndex = -1): void {
    const insertAt = afterIndex === -1 ? this.currentIndex + 1 : afterIndex + 1;
    this.queue.splice(insertAt, 0, item);
    if (this.originalQueue) {
      // 同步到原始队列（追加到末尾，保持原始顺序的完整性）
      this.originalQueue.push(item);
    }
    if (insertAt <= this.currentIndex) {
      this.currentIndex++;
    }
    this.broadcastQueueChanged();
  }

  /** 从队列移除 */
  async remove(index: number): Promise<void> {
    if (index < 0 || index >= this.queue.length) return;
    const isCurrentPlaying = index === this.currentIndex;
    const removed = this.queue.splice(index, 1)[0];
    if (this.originalQueue) {
      const origIdx = this.originalQueue.findIndex((t) => t.id === removed.id);
      if (origIdx !== -1) this.originalQueue.splice(origIdx, 1);
    }
    if (index < this.currentIndex) {
      this.currentIndex--;
    } else if (isCurrentPlaying) {
      // 删除了当前播放的歌
      if (this.queue.length === 0) {
        this.currentIndex = -1;
        this.broadcastQueueChanged();
        this.broadcastQueueEnded();
        return;
      }
      if (this.currentIndex >= this.queue.length) {
        this.currentIndex = 0;
      }
      // 自动播放新的当前歌
      this.broadcastQueueChanged();
      await this.loadCurrent();
      return;
    }
    this.broadcastQueueChanged();
  }

  /** 移动队列项 */
  move(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= this.queue.length) return;
    if (toIndex < 0 || toIndex >= this.queue.length) return;

    const [item] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, item);

    if (this.currentIndex === fromIndex) {
      this.currentIndex = toIndex;
    } else {
      if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) {
        this.currentIndex--;
      } else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) {
        this.currentIndex++;
      }
    }
    this.broadcastQueueChanged();
  }

  /** 清空队列 */
  clear(): void {
    this.queue = [];
    this.originalQueue = null;
    this.currentIndex = -1;
    this.broadcastQueueChanged();
  }

  /**
   * 洗牌：备份原始顺序，将当前播放的歌移到首位，其余打乱
   */
  private applyShuffle(): void {
    if (this.queue.length <= 1) return;
    // 备份原始顺序
    this.originalQueue = [...this.queue];
    // 取出当前播放的歌
    const currentTrack = this.queue[this.currentIndex];
    // 其余的歌打乱
    const rest = this.queue.filter((_, i) => i !== this.currentIndex);
    shuffleArray(rest);
    // 当前播放的歌放首位
    this.queue = [currentTrack, ...rest];
    this.currentIndex = 0;
  }

  /**
   * 恢复原始队列顺序，定位到当前播放的歌
   */
  private restoreOriginalOrder(): void {
    if (!this.originalQueue) return;

    const currentTrack = this.getCurrentItem();
    this.queue = [...this.originalQueue];
    this.originalQueue = null;

    // 在原始队列中找到当前播放的歌
    if (currentTrack) {
      const idx = this.queue.findIndex((t) => t.id === currentTrack.id);
      this.currentIndex = idx !== -1 ? idx : 0;
    }
  }

  /** 加载当前索引的歌曲 */
  private async loadCurrent(): Promise<void> {
    const item = this.getCurrentItem();
    if (!item?.path || !this.loadTrack) return;
    try {
      await this.loadTrack(item.path);
    } catch (error) {
      console.error("[Playback] 加载失败:", item.path, error);
    }
  }

  /** 广播队列变更事件 */
  private broadcastQueueChanged(): void {
    broadcast("playback:event", {
      type: "queue:changed",
      data: { currentIndex: this.currentIndex, length: this.queue.length },
    });
  }

  /** 广播队列播放结束 */
  private broadcastQueueEnded(): void {
    broadcast("playback:event", { type: "queue:ended" });
  }
}

/** 播放控制服务单例 */
export const playbackService = new PlaybackService();
