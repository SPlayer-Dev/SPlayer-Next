import type { LyricPlayer } from "@applemusic-like-lyrics/core";
import { alignRubyGroups, type RubyLayoutItem } from "./ruby-layout";

interface RubyMeasurement extends RubyLayoutItem {
  ruby: HTMLElement;
}

/**
 * 按实际宽度合排连续汉字注音，并扩展掩码空间；保留原节点与逐词时间轴。
 * @param player - AMLL 播放器
 * @returns 解除尺寸与 DOM 监听的清理函数
 */
export const observeAmllRubyLayout = (player: LyricPlayer): (() => void) => {
  const root = player.getElement();
  const observed = new Set<HTMLElement>();

  const sync = (): void => {
    if (document.hidden || !root.isConnected || root.clientWidth === 0) return;
    const targets = new Set<HTMLElement>([root]);
    const measurements: RubyMeasurement[] = [];

    for (const line of root.querySelectorAll<HTMLElement>(".FmKaba_lyricMainLine")) {
      targets.add(line);
      const scale = line.getBoundingClientRect().width / line.offsetWidth;
      if (!scale) continue;
      const lineMeasurements: RubyMeasurement[] = [];

      for (const word of line.querySelectorAll<HTMLElement>(".FmKaba_wordWithRuby")) {
        const ruby = word.querySelector<HTMLElement>(".FmKaba_rubyWord");
        const body = word.querySelector<HTMLElement>(".FmKaba_wordBody");
        if (!ruby || !body) continue;
        targets.add(body);
        const parts = Array.from(ruby.children) as HTMLElement[];
        parts.forEach((part) => targets.add(part));
        const rect = body.getBoundingClientRect();
        const item: RubyMeasurement = {
          word,
          ruby,
          text: Array.from(body.childNodes)
            .filter((node) => !(node instanceof Element && node.matches(".FmKaba_romanWord")))
            .map((node) => node.textContent ?? "")
            .join(""),
          left: rect.left / scale,
          top: rect.top / scale,
          width: rect.width / scale,
          // 零宽 flex 容器的 scrollWidth 不包含向左溢出的部分，需测量全部注音片段。
          rubyWidth: parts.reduce(
            (sum, part) => sum + part.getBoundingClientRect().width / scale,
            0,
          ),
          fontSize: Number.parseFloat(getComputedStyle(word).fontSize),
          offset: 0,
        };
        lineMeasurements.push(item);
      }
      alignRubyGroups(lineMeasurements);
      measurements.push(...lineMeasurements);
    }

    for (const target of observed) {
      if (!targets.has(target)) {
        resizeObserver.unobserve(target);
        observed.delete(target);
      }
    }
    for (const target of targets) {
      if (!observed.has(target)) {
        resizeObserver.observe(target);
        observed.add(target);
      }
    }

    const changedWords = new Set<HTMLElement>();
    for (const item of measurements) {
      const { word, ruby, offset, rubyWidth, width, fontSize } = item;
      const shift = `${offset.toFixed(3)}px`;
      if (ruby.style.getPropertyValue("--amll-ruby-offset") !== shift)
        ruby.style.setProperty("--amll-ruby-offset", shift);
      const padding = `${Math.ceil(Math.max(fontSize, Math.abs(offset) + (rubyWidth - width) / 2 + 1))}px`;
      if (word.style.getPropertyValue("--amll-ruby-padding") !== padding) {
        word.style.setProperty("--amll-ruby-padding", padding);
        changedWords.add(word);
      }
    }
    if (!changedWords.size) return;
    for (const group of player.currentLyricGroups) {
      for (const line of [group.mainLine, group.bgLine]) {
        if (line && Array.from(changedWords).some((word) => line.getElement().contains(word)))
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
