/**
 * 拼音音译过滤
 *
 * 在强迫症预设开启「拒绝胎教模式」时，剔除 TTML 歌词中的普通话汉语拼音音译（保留粤拼等方言方案）
 */

/**
 * 获取元素属性值，兼容命名空间前缀（如 xml:lang → lang，ttm:role → role）
 * @param el - 目标 DOM 元素
 * @param name - 属性名（不含命名空间前缀）
 * @returns 属性值，未找到返回 null
 */
const getAttr = (el: Element, name: string): string | null => {
  const direct = el.getAttribute(name);
  if (direct !== null) return direct;
  for (const attr of Array.from(el.attributes)) {
    if (attr.localName === name || attr.name.endsWith(":" + name)) {
      return attr.value;
    }
  }
  return null;
};

/**
 * 判断语言标签是否为普通话汉语拼音（排除粤拼等方言方案及其他语言）
 * @param rawLang - 原始语言标签
 * @returns 是否为汉语拼音
 */
export const isPinyinTransliteration = (rawLang: string | null | undefined): boolean => {
  if (!rawLang) return false;
  const lang = rawLang.trim().toLowerCase().replace(/_/g, "-");
  if (!lang) return false;

  // 排除粤语拼音（如 zh-Latn-jyutping, zh-Latn-jyupin, yue-Latn 等）及其他方言方案
  if (
    lang.includes("jyutping") ||
    lang.includes("jyupin") ||
    lang.includes("cantonese") ||
    lang.startsWith("yue")
  ) {
    return false;
  }

  // 匹配普通话汉语拼音：zh-Latn-pinyin, zh-pinyin, cmn-Latn-pinyin, zh-cmn-Latn-pinyin 等
  return (
    lang === "zh-latn-pinyin" ||
    lang === "zh-pinyin" ||
    lang === "cmn-latn-pinyin" ||
    lang === "zh-cmn-latn-pinyin" ||
    ((lang.startsWith("zh") || lang.startsWith("cmn")) && lang.includes("pinyin"))
  );
};

/**
 * 从 TTML 歌词文本中剔除普通话汉语拼音音译（保留粤拼等其他方言方案）
 * @param ttmlText - 原始 TTML XML 字符串
 * @returns 剔除拼音后的 TTML XML 字符串
 */
export const stripPinyinFromTTML = (ttmlText: string): string => {
  if (!ttmlText || !/pinyin/i.test(ttmlText)) {
    return ttmlText;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(ttmlText, "application/xml");
    if (doc.querySelector("parsererror")) {
      return ttmlText;
    }

    let modified = false;
    const allElements = Array.from(doc.querySelectorAll("*"));
    for (const el of allElements) {
      const localName = (el.localName || el.tagName.split(":").pop() || "").toLowerCase();
      if (
        localName === "transliteration" ||
        localName === "transliterations" ||
        localName === "text"
      ) {
        const lang = getAttr(el, "lang");
        if (isPinyinTransliteration(lang)) {
          el.remove();
          modified = true;
          continue;
        }
      }

      const role = getAttr(el, "role");
      if (role === "x-roman") {
        const lang = getAttr(el, "lang");
        if (isPinyinTransliteration(lang)) {
          el.remove();
          modified = true;
        }
      }
    }

    if (!modified) {
      return ttmlText;
    }

    return new XMLSerializer().serializeToString(doc);
  } catch (error) {
    console.error("[pinyin] stripPinyinFromTTML failed:", error);
    return ttmlText;
  }
};
