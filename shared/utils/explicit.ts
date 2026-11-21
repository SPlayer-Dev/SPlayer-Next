/** 歌名末尾的 Explicit 版本后缀，从左括号起匹配，避免在空白段内逐位回溯 */
const EXPLICIT_SUFFIX =
  /(?:\(\s*explicit(?:\s+version)?\s*\)|\[\s*explicit(?:\s+version)?\s*\]|（\s*explicit(?:\s+version)?\s*）|【\s*explicit(?:\s+version)?\s*】)\s*$/i;

/**
 * 判断文本是否为 Explicit（脏标）版本标记
 * @param text - 版本后缀或完整歌名
 * @returns 文本末尾是否为 Explicit 标记
 */
export const isExplicitLabel = (text?: string | null): boolean =>
  text ? EXPLICIT_SUFFIX.test(text) : false;

/**
 * 移除歌名末尾的 Explicit 版本标记
 * @param title - 歌名
 * @returns 去除标记及标记前后空白后的歌名；无标记时原样返回
 */
export const stripExplicitLabel = (title?: string | null): string => {
  const text = title ?? "";
  if (!EXPLICIT_SUFFIX.test(text)) return text;
  return text.replace(EXPLICIT_SUFFIX, "").trim();
};
