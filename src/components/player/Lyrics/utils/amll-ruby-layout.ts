import type { LyricPlayer } from "@applemusic-like-lyrics/core";
import { alignRubyGroups, measureRuby, type RubyLayoutItem } from "./ruby-layout";

/**
 * 按实际宽度合排连续汉字注音，并扩展掩码空间；保留原节点与逐词时间轴。
 * @param player - AMLL 播放器
 * @returns 解除尺寸与 DOM 监听的清理函数
 */
export const observeAmllRubyLayout = (player: LyricPlayer): (() => void) => {
  const root = player.getElement();
  let observed = new Set<HTMLElement>();

  const sync = (): void => {
    if (document.hidden || !root.isConnected || root.clientWidth === 0) return;
    const targets = new Set<HTMLElement>([root]);
    const measurements: RubyLayoutItem[] = [];

    for (const line of root.querySelectorAll<HTMLElement>(".FmKaba_lyricMainLine")) {
      targets.add(line);
      const scale = line.getBoundingClientRect().width / line.offsetWidth;
      if (!scale) continue;
      const lineMeasurements: RubyLayoutItem[] = [];

      for (const word of line.querySelectorAll<HTMLElement>(".FmKaba_wordWithRuby")) {
        const ruby = word.querySelector<HTMLElement>(".FmKaba_rubyWord");
        const body = word.querySelector<HTMLElement>(".FmKaba_wordBody");
        if (!ruby || !body) continue;
        targets.add(body);
        for (const part of ruby.children) targets.add(part as HTMLElement);
        lineMeasurements.push(measureRuby(word, body, ruby, scale));
      }
      alignRubyGroups(lineMeasurements);
      measurements.push(...lineMeasurements);
    }

    for (const target of observed) {
      if (!targets.has(target)) resizeObserver.unobserve(target);
    }
    for (const target of targets) {
      if (!observed.has(target)) resizeObserver.observe(target);
    }
    observed = targets;

    const changedWords: HTMLElement[] = [];
    for (const { word, ruby, offset, rubyWidth, width, fontSize } of measurements) {
      const shift = `${offset.toFixed(3)}px`;
      if (ruby.style.getPropertyValue("--amll-ruby-offset") !== shift)
        ruby.style.setProperty("--amll-ruby-offset", shift);
      const padding = `${Math.ceil(Math.max(fontSize, Math.abs(offset) + (rubyWidth - width) / 2 + 1))}px`;
      if (word.style.getPropertyValue("--amll-ruby-padding") !== padding) {
        word.style.setProperty("--amll-ruby-padding", padding);
        changedWords.push(word);
      }
    }
    if (!changedWords.length) return;
    for (const group of player.currentLyricGroups) {
      for (const line of [group.mainLine, group.bgLine]) {
        if (line && changedWords.some((word) => line.getElement().contains(word)))
          line.updateMaskImageSync();
      }
    }
  };

  const resizeObserver = new ResizeObserver(sync);
  const mutationObserver = new MutationObserver(sync);
  mutationObserver.observe(root, { childList: true, characterData: true, subtree: true });
  resizeObserver.observe(root);
  observed.add(root);
  document.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    mutationObserver.disconnect();
    resizeObserver.disconnect();
    observed.clear();
    document.removeEventListener("visibilitychange", sync);
  };
};
