export interface RubyLayoutItem {
  word: HTMLElement;
  ruby: HTMLElement;
  text: string;
  left: number;
  top: number;
  width: number;
  rubyWidth: number;
  fontSize: number;
  offset: number;
}

const HAN_GROUP = /^(?:[\p{Script=Han}\u3005\u3006]\p{Variation_Selector}?)+$/u;

/** 测量正文与注音的实际尺寸，排除行缩放和正文容器中的逐词罗马音。 */
export const measureRuby = (
  word: HTMLElement,
  body: Element,
  ruby: HTMLElement,
  scale: number,
): RubyLayoutItem => {
  const rect = body.getBoundingClientRect();
  // AMLL 的零宽容器会向两侧溢出，需累加子片段；原生 rt 直接测量自身。
  const parts = ruby.childElementCount ? Array.from(ruby.children) : [ruby];
  return {
    word,
    ruby,
    text: Array.from(body.childNodes)
      .filter((node) => !(node instanceof Element && node.matches(".FmKaba_romanWord")))
      .map((node) => node.textContent ?? "")
      .join(""),
    left: rect.left / scale,
    top: rect.top / scale,
    width: rect.width / scale,
    rubyWidth: parts.reduce((sum, part) => sum + part.getBoundingClientRect().width / scale, 0),
    fontSize: Number.parseFloat(getComputedStyle(word).fontSize),
    offset: 0,
  };
};

/**
 * 连续汉字注音发生碰撞时合排整组，以正文范围的中心对齐注音总宽度。
 * @param items - 同一歌词行中按 DOM 顺序测量的注音，尺寸已去除行缩放
 */
export const alignRubyGroups = (items: RubyLayoutItem[]): void => {
  const between = document.createRange();
  let group: RubyLayoutItem[] = [];
  const flush = (): void => {
    const overflowing = group.some((item) => item.rubyWidth > item.width + 0.5);
    const overlapping = group.some((item, index) => {
      const previous = group[index - 1];
      return (
        previous &&
        previous.left + (previous.width + previous.rubyWidth) / 2 >
          item.left + (item.width - item.rubyWidth) / 2 + 0.5
      );
    });
    if (overflowing && overlapping) {
      const first = group[0];
      const last = group[group.length - 1];
      const rubyWidth = group.reduce((sum, item) => sum + item.rubyWidth, 0);
      let left = (first.left + last.left + last.width - rubyWidth) / 2;
      for (const item of group) {
        item.offset = left + item.rubyWidth / 2 - (item.left + item.width / 2);
        left += item.rubyWidth;
      }
    }
    group = [];
  };

  for (const item of items) {
    item.offset = 0;
    if (!item.rubyWidth || !HAN_GROUP.test(item.text)) {
      flush();
      continue;
    }
    const previous = group[group.length - 1];
    if (previous) {
      // 跨词容器检查真实文本间隔；上浮动画的小幅高度差不应被当作换行。
      between.setStartAfter(previous.word);
      between.setEndBefore(item.word);
      if (between.toString() || Math.abs(item.top - previous.top) > item.fontSize / 2) flush();
    }
    group.push(item);
  }
  flush();
};
