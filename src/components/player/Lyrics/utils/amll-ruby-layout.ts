import type { LyricPlayer } from "@applemusic-like-lyrics/core";

/**
 * 按注音实际宽度扩展 AMLL 单词的掩码绘制空间，负外边距由样式抵消。
 * @param player - AMLL 播放器
 * @returns 解除尺寸与 DOM 监听的清理函数
 */
export const observeAmllRubyLayout = (player: LyricPlayer): (() => void) => {
  const root = player.getElement();
  const sync = (): void => {
    if (!root.isConnected || root.clientWidth === 0) return;
    const targets = new Set<HTMLElement>();
    const updates: [HTMLElement, string][] = [];
    for (const word of root.querySelectorAll<HTMLElement>(".FmKaba_wordWithRuby")) {
      const ruby = word.querySelector<HTMLElement>(".FmKaba_rubyWord");
      const body = word.querySelector<HTMLElement>(".FmKaba_wordBody");
      if (!ruby?.childElementCount || !body) continue;
      targets.add(word);
      targets.add(ruby);
      targets.add(body);
      const fontSize = Number.parseFloat(getComputedStyle(word).fontSize);
      const padding = `${Math.ceil(Math.max(fontSize, (ruby.scrollWidth - body.offsetWidth) / 2 + 1))}px`;
      if (word.style.getPropertyValue("--amll-ruby-padding") !== padding)
        updates.push([word, padding]);
    }
    resizeObserver.disconnect();
    targets.forEach((target) => resizeObserver.observe(target));
    updates.forEach(([word, padding]) => word.style.setProperty("--amll-ruby-padding", padding));
    if (!updates.length) return;
    for (const group of player.currentLyricGroups) {
      for (const line of [group.mainLine, group.bgLine]) {
        if (line && updates.some(([word]) => line.getElement().contains(word)))
          line.updateMaskImageSync();
      }
    }
  };
  const resizeObserver = new ResizeObserver(sync);
  const mutationObserver = new MutationObserver(sync);
  mutationObserver.observe(root, { childList: true, subtree: true });
  sync();
  return () => {
    mutationObserver.disconnect();
    resizeObserver.disconnect();
  };
};
