/** 支持匹配的末尾括号对（右括号到左括号映射） */
const BRACKET_PAIRS: Record<string, string> = {
  ")": "(",
  "]": "[",
  "）": "（",
  "】": "【",
};

/** 单个 Explicit 版本标记匹配规则 */
const EXPLICIT_TOKEN = /^explicit(?:\s+version)?$/i;

/** 文本末尾成对括号的解析结果 */
interface TrailingGroup {
  /** 括号之前的正文前缀 */
  prefix: string;
  /** 匹配到的左括号字符 */
  open: string;
  /** 匹配到的右括号字符 */
  close: string;
  /** 括号内按 `|` 拆分并去空白后的分段列表 */
  parts: string[];
}

/**
 * 解析文本末尾成对括号内的分段列表（兼容 `|` 组合标签）
 * @param text - 原始文本
 * @returns 末尾括号分组信息；无合法末尾括号时返回 null
 */
const parseTrailingGroup = (text: string): TrailingGroup | null => {
  const trimmed = text.trimEnd();
  const close = trimmed.at(-1);
  const open = close ? BRACKET_PAIRS[close] : undefined;
  if (!open || !close) return null;
  const openIndex = trimmed.lastIndexOf(open);
  if (openIndex < 0) return null;
  const inner = trimmed.slice(openIndex + 1, -1);
  if (inner.includes(close)) return null;
  return {
    prefix: trimmed.slice(0, openIndex),
    open,
    close,
    parts: inner.split("|").map((part) => part.trim()),
  };
};

/**
 * 判断文本是否为 Explicit（脏标）版本标记
 * @param text - 版本后缀或完整歌名
 * @returns 文本末尾括号内是否包含独立的 Explicit 标记
 */
export const isExplicitLabel = (text?: string | null): boolean => {
  if (!text) return false;
  const group = parseTrailingGroup(text);
  return group ? group.parts.some((part) => EXPLICIT_TOKEN.test(part)) : false;
};

/**
 * 移除歌名末尾括号内的 Explicit 版本标记，保留同括号内的其他标签
 * @param title - 歌名
 * @returns 清理后的歌名；无标记时原样返回
 */
export const stripExplicitLabel = (title?: string | null): string => {
  const text = title ?? "";
  const group = parseTrailingGroup(text);
  if (!group || !group.parts.some((part) => EXPLICIT_TOKEN.test(part))) return text;
  const kept = group.parts.filter((part) => part && !EXPLICIT_TOKEN.test(part));
  if (kept.length === 0) return group.prefix.trim();
  return `${group.prefix}${group.open}${kept.join("|")}${group.close}`.trim();
};
