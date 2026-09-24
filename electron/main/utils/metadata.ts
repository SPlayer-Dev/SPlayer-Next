import type { Artist, Album } from "@shared/types/player";

/** 常见的歌手分隔符：/ & ; , × | 、 ， feat. ft. */
const ARTIST_SEPARATOR = /\s*(?:feat\.?|ft\.?)\s+|[/&;,×|、，]\s*/i;

/**
 * 将歌手字符串按常见分隔符拆分为 Artist 数组
 * @param raw - 原始歌手字符串（可能含多个歌手，如 "周杰伦/林俊杰"）
 * @returns Artist 数组，空字符串返回空数组
 */
export const parseArtists = (raw: string): Artist[] => {
  if (!raw) return [];
  return raw
    .split(ARTIST_SEPARATOR)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
};

/**
 * 将 Artist 数组格式化为字符串
 * @param artists - Artist 数组
 * @param separator - 分隔符，默认 " / "
 * @returns 拼接后的字符串，空数组返回空字符串
 */
export const formatArtists = (artists: Artist[], separator = " / "): string => {
  return artists.map((artist) => artist.name).join(separator);
};

/**
 * 提取歌手名称数组
 * @param artists - Artist 数组
 * @returns 名称数组，已去除空白与空项
 */
export const artistNames = (artists: Artist[]): string[] => {
  return artists.map((artist) => artist.name.trim()).filter(Boolean);
};

/**
 * 将专辑字符串转为 Album 对象
 * @param raw - 原始专辑名
 * @returns Album 对象，空字符串返回 undefined
 */
export const parseAlbum = (raw: string): Album | undefined => {
  const name = raw.trim();
  return name ? { name } : undefined;
};

/**
 * 已知包含分隔符字符的复合流派，拆分前先整体保护
 * 例如 R&B、Rock & Roll 中的 & 属于流派名称本身，不能当作分隔符
 */
const COMPOUND_GENRES = [
  "r&b",
  "r&b/soul",
  "rock & roll",
  "rock'n'roll",
  "rock n roll",
  "rhythm & blues",
  "drum & bass",
  "drum'n'bass",
  "singer/songwriter",
  "hip hop/rap",
  "hip-hop/rap",
  "stage & screen",
  "brass & military",
  "country & western",
  "funk / soul",
  "sound & effects",
];

/**
 * 复合流派匹配规则：分隔符两侧的空白可有可无
 * "R & B" 与 "R&B"、"Singer / Songwriter" 与 "Singer/Songwriter" 视为同一个流派
 */
const COMPOUND_PATTERNS = COMPOUND_GENRES.map((genre) => ({
  canonical: genre,
  pattern: new RegExp(
    genre
      .split(/\s*([&/'])\s*/)
      .map((part) =>
        /^[&/']$/.test(part) ? `\\s*\\${part}\\s*` : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join(""),
    "gi",
  ),
}));

/**
 * 流派分隔符：
 * - 逗号、分号、中文顿号/逗号、竖线：始终视为分隔符
 * - 双斜杠 `//`：始终视为分隔符
 * - 单斜杠：仅在两侧有空白时才是分隔符（`Singer/Songwriter`、`R&B/Soul` 是同一个流派）
 * - `&`：仅在两侧有空白时才是分隔符（`R&B` 是同一个流派）
 */
const GENRE_SEPARATOR = /\s*[,;、，|]\s*|\s*\/{2,}\s*|\s+\/\s+|\s+&\s+|\0/;

/** 复合流派占位符使用私有区字符，避免与真实标签内容冲突 */
const PLACEHOLDER_MARK = "\uE000";

/** 占位符匹配规则 */
const PLACEHOLDER_PATTERN = new RegExp(`${PLACEHOLDER_MARK}(\\d+)${PLACEHOLDER_MARK}`, "g");

/** 去掉两端的引号、括号等包裹字符与多余空白 */
const cleanGenre = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .trim()
    // ID3v1 数字流派前缀，如 "(17)Rock"
    .replace(/^\((\d+)\)\s*/, "")
    .replace(/^["'“”「『([]+|["'“”」』)\]]+$/g, "")
    .trim();

/**
 * 解析流派标签字符串
 *
 * 流派标签写法混乱，这里遵循以下约定：
 * 1. `Singer/Songwriter`、`R&B/Soul`：无空格的斜杠属于名称本身，识别为单个流派
 * 2. `Pop Rock`：空格不是分隔符，识别为单个流派
 * 3. `R&B`：无空格的 `&` 属于名称本身，识别为单个流派
 * 4. `Pop, Rock`、`Pop; Rock`、`Pop // Rock`、`Pop & Rock`、`Pop / Rock`：识别为两个流派
 * 5. 已知复合流派（如 `Rock & Roll`）整体保护，不会被拆开
 *
 * @param raw - 原始流派标签文本
 * @returns 流派名称数组，已去重（忽略大小写）并保留首次出现的写法
 */
export const parseGenres = (raw?: string | null): string[] => {
  if (!raw) return [];
  // 复合流派先替换为占位符，避免被分隔符规则拆开
  const placeholders: string[] = [];
  let text = raw;
  for (const { pattern } of COMPOUND_PATTERNS) {
    text = text.replace(pattern, (matched) => {
      placeholders.push(matched);
      return `${PLACEHOLDER_MARK}${placeholders.length - 1}${PLACEHOLDER_MARK}`;
    });
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(GENRE_SEPARATOR)) {
    // 还原占位符
    const restored = part.replace(PLACEHOLDER_PATTERN, (_match, index: string) =>
      cleanGenre(placeholders[Number(index)] ?? ""),
    );
    const name = cleanGenre(restored);
    // 过滤空值与 ID3v1 未知流派
    if (!name || /^\(?\d+\)?$/.test(name)) continue;
    if (/^(unknown|other|未知|其他)$/i.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
};

/**
 * 将流派数组格式化为展示字符串
 * @param genres - 流派数组
 * @param separator - 分隔符，默认 " / "
 * @returns 拼接后的字符串，空数组返回空字符串
 */
export const formatGenres = (genres?: string[], separator = " / "): string =>
  (genres ?? []).filter(Boolean).join(separator);
