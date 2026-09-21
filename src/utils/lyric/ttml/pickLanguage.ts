/**
 * 多语言翻译/音译候选标签两阶段评分匹配器
 * 优先全量遍历所有候选段，通过权重打分解决先出现繁体导致简体被截胡的问题
 */

/** 简体中文常见标签集合 */
const HANS_TAGS = new Set(["zh-cn", "zh-sg", "zh-hans", "zh-hans-cn", "zh-hans-sg", "zh-cmn-hans"]);

/** 繁体中文常见标签集合 */
const HANT_TAGS = new Set([
  "zh-tw",
  "zh-hk",
  "zh-mo",
  "zh-hant",
  "zh-hant-tw",
  "zh-hant-hk",
  "zh-hant-mo",
  "zh-cmn-hant",
]);

/**
 * 规范化 BCP-47 语言代码标签
 * @param lang - 原始语言代码
 * @returns 规范化后的小写横杠格式字符串
 */
export const normalizeLang = (lang: string | null | undefined): string =>
  (lang ?? "").trim().toLowerCase().replace(/_/g, "-");

/**
 * 判断语言标签是否属于简体中文体系
 * @param tag - 规范化后的语言代码
 * @returns 是否属于简体
 */
const isHans = (tag: string): boolean =>
  HANS_TAGS.has(tag) || tag.startsWith("zh-hans") || tag.endsWith("-cn") || tag.endsWith("-sg");

/**
 * 判断语言标签是否属于繁体中文体系
 * @param tag - 规范化后的语言代码
 * @returns 是否属于繁体
 */
const isHant = (tag: string): boolean =>
  HANT_TAGS.has(tag) ||
  tag.startsWith("zh-hant") ||
  tag.endsWith("-tw") ||
  tag.endsWith("-hk") ||
  tag.endsWith("-mo");

/**
 * 计算单个候选语言与偏好语言之间的匹配得分（0 ~ 100）
 * @param candidate - 候选语言代码
 * @param preferred - 偏好语言代码
 * @returns 匹配得分
 */
export const computeLangMatchScore = (candidate: string, preferred: string): number => {
  const c = normalizeLang(candidate);
  const p = normalizeLang(preferred);

  if (!c || !p) return 0;
  if (c === p) return 100;

  // 中文体系细分打分
  const pIsHans = isHans(p);
  const pIsHant = isHant(p);
  const cIsHans = isHans(c);
  const cIsHant = isHant(c);

  if (pIsHans) {
    if (cIsHans) return 90;
    if (c === "zh") return 50;
    if (cIsHant) return 10;
    return 0;
  }

  if (pIsHant) {
    if (cIsHant) return 90;
    if (c === "zh") return 50;
    if (cIsHans) return 10;
    return 0;
  }

  // 通用语言子标签匹配（如 en-US 与 en，ja-Latn 与 ja）
  const cParts = c.split("-");
  const pParts = p.split("-");

  // 主语言代码不同（如 en 与 ja）
  if (cParts[0] !== pParts[0]) return 0;

  // 主语言相同，前缀包含（如 en-US 匹配 en）
  if (c.startsWith(`${p}-`) || p.startsWith(`${c}-`)) return 80;

  // 仅主语言代码相同
  return 40;
};

/**
 * 从候选多语言列表中挑选最符合偏好语言的条目索引
 * 采用两阶段评分：全量评估所有候选后再按最高分择优，避免排序靠前的弱匹配项截胡
 * @param candidateLangs - 所有候选段的语言代码列表
 * @param preferredLang - 目标偏好语言代码
 * @returns 最优匹配的条目索引，若无任何匹配则默认返回 0（若列表非空）或 -1
 */
export const pickBestLanguageIndex = (
  candidateLangs: readonly (string | undefined)[],
  preferredLang: string | undefined,
): number => {
  if (candidateLangs.length === 0) return -1;
  if (!preferredLang) return 0;

  let bestIndex = 0;
  let highestScore = 0;

  for (let i = 0; i < candidateLangs.length; i++) {
    const lang = candidateLangs[i];
    if (!lang) continue;

    const score = computeLangMatchScore(lang, preferredLang);
    if (score > highestScore) {
      highestScore = score;
      bestIndex = i;
    }
  }

  return highestScore > 0 ? bestIndex : 0;
};
