import { applyLyricLanguages, type LyricLanguage, type LyricLine } from "lyric-kit";
import type { Track } from "@shared/types/player";
import { hexToRgb } from "@/utils/color";

/** 海报中的一段文本（原文及其翻译、音译） */
export interface LyricPosterTextLine {
  text: string;
  /** 原文语言，沿用播放器的识别结果 */
  language?: LyricLanguage;
  /** 翻译 */
  translation?: string;
  /** 音译 */
  romaji?: string;
}

/** 海报中的一行歌词 */
export interface LyricPosterLine extends LyricPosterTextLine {
  /** 对唱行 */
  duet?: boolean;
  /** 所属主行下方的背景行，以弱化样式绘制 */
  background?: LyricPosterTextLine;
  /** 背景行起始早于主行（前置背景行），绘制在主行上方 */
  backgroundFirst?: boolean;
}

export interface LyricPosterOptions {
  track: Track;
  lines: LyricPosterLine[];
  /** 无封面时的背景色 HEX，可空 */
  fallbackColor?: string | null;
  /** 沿用现有设置的 CSS 字体族列表 */
  fonts?: {
    global?: string;
    lyric?: string;
    chinese?: string;
    japanese?: string;
    korean?: string;
    latin?: string;
  };
}

const SCALE = 3;
const MAX_CANVAS_PX = 16000;
const WIDTH = 720;
const PAD_X = 56;
const PAD_TOP = 64;
const PAD_BOTTOM = 30;

const FONT_STACK = '-apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';

const LYRIC_LH = 48;
const TRANS_LH = 34;
const ROMAJI_LH = 32;
const SUBLINE_GAP = 8;
const BLOCK_GAP = 30;
const THUMB = 72;
const THUMB_RADIUS = 16;
const THUMB_TEXT_GAP = 18;
const HEADER_GAP = 44;
const WATERMARK_GAP = 26;
const WATERMARK_H = 16;
/** 背景行组与主行组之间的间距 */
const BG_GROUP_GAP = 10;

/** 内容区宽度 */
const CONTENT_WIDTH = WIDTH - PAD_X * 2;

/** 单个文本层级的排版参数，gap 为同组内位于上一层级下方的间距 */
interface TextStyle {
  /** Canvas 字形与字号，不含字体族 */
  style: string;
  lineHeight: number;
  color: string;
  gap: number;
}

interface StyleSet {
  main: TextStyle;
  translation: TextStyle;
  romaji: TextStyle;
}

const LYRIC_STYLES: StyleSet = {
  main: { style: "bold 34px", lineHeight: LYRIC_LH, color: "#ffffff", gap: 0 },
  translation: {
    style: "24px",
    lineHeight: TRANS_LH,
    color: "rgba(255, 255, 255, 0.6)",
    gap: SUBLINE_GAP,
  },
  romaji: {
    style: "italic 22px",
    lineHeight: ROMAJI_LH,
    color: "rgba(255, 255, 255, 0.45)",
    gap: SUBLINE_GAP,
  },
};

/** 背景行整体弱化：字号与透明度低于主行，主句加粗且比译文、音译更亮 */
const BG_STYLES: StyleSet = {
  main: { style: "bold 22px", lineHeight: 36, color: "rgba(255, 255, 255, 0.7)", gap: 0 },
  translation: { style: "18px", lineHeight: 28, color: "rgba(255, 255, 255, 0.4)", gap: 4 },
  romaji: { style: "italic 18px", lineHeight: 26, color: "rgba(255, 255, 255, 0.35)", gap: 4 },
};

/** 待测量的一段文本及其排版参数 */
interface TextSpec {
  text: string;
  style: TextStyle;
  language?: LyricLanguage;
}

/** 已折行的一段文本 */
interface MeasuredRow {
  lines: string[];
  font: string;
  lang: string;
  style: TextStyle;
}

/** Blob 转 dataURL */
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** 把当前曲目封面解析为 dataURL */
const resolveCoverDataUrl = async (track: Track): Promise<string | null> => {
  // 本地：主进程返回解码后的原图 dataURL
  if (track.source === "local") {
    const res = await window.api.player.getCoverRaw();
    return res.success && res.data ? res.data : null;
  }
  // 远程：主进程拉字节回渲染层
  const url = track.coverOriginal || track.cover;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await window.api.system.fetchRemoteBytes(url);
    if (!res.success || !res.data) return null;
    return await blobToDataUrl(new Blob([new Uint8Array(res.data)]));
  } catch {
    return null;
  }
};

/** 按宽度折行，英文按词、CJK 按字回退 */
const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  if (!text) return [];
  const lines: string[] = [];
  let line = "";
  const breakByChar = (token: string): void => {
    for (const char of token) {
      if (line && ctx.measureText(line + char).width > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
  };
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    if (ctx.measureText(line + word).width <= maxWidth) {
      line += word;
    } else if (ctx.measureText(word).width > maxWidth) {
      breakByChar(word);
    } else {
      if (line.trim()) lines.push(line.replace(/\s+$/, ""));
      line = word.replace(/^\s+/, "");
    }
  }
  if (line.trim()) lines.push(line.replace(/\s+$/, ""));
  return lines;
};

/** 加载图片，失败回 null */
const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/** object-fit: cover 方式绘制图片 */
const drawCovered = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void => {
  const imgRatio = img.width / img.height;
  const boxRatio = dw / dh;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (imgRatio > boxRatio) {
    sw = img.height * boxRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / boxRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
};

/**
 * 把选中歌词绘制成一张海报 PNG（自动解析当前封面）
 * @param options - 曲目、歌词行、背景色和导出字体配置
 * @returns PNG Blob
 */
export const createLyricPoster = async (options: LyricPosterOptions): Promise<Blob> => {
  const { track, lines, fallbackColor, fonts = {} } = options;
  const globalFont = `${fonts.global ? `${fonts.global}, ` : ""}${FONT_STACK}`;
  const lyricFont = `${fonts.lyric ? `${fonts.lyric}, ` : ""}${globalFont}`;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");
  // 当前 DOM 类型尚未声明 Canvas 文本语言属性
  const textContext = ctx as CanvasRenderingContext2D & { lang: string };

  /**
   * 获取文本语言，缺少播放器语言信息时按歌词识别规则推断
   * @param text - 需要识别的歌词文本
   * @param language - 播放器已识别的语言
   * @returns 文本语言
   */
  const languageForText = (text: string, language?: LyricLanguage): LyricLanguage | undefined => {
    if (language) return language;
    const detected: LyricLine[] = [
      {
        words: [{ word: text, startTime: 0, endTime: 0 }],
        translatedLyric: "",
        romanLyric: "",
        startTime: 0,
        endTime: 0,
        isBG: false,
        isDuet: false,
      },
    ];
    applyLyricLanguages(detected);
    return detected[0].language;
  };

  /**
   * 按文本语言解析字体，保证测量和绘制使用相同字体
   * @param text - 原文、翻译或音译
   * @param style - Canvas 字号与字形
   * @param language - 播放器已识别的原文语言
   * @returns 可直接赋给 Canvas 的字体描述
   */
  const fontForText = (text: string, style: string, language?: LyricLanguage): string => {
    const resolvedLanguage = languageForText(text, language);
    const family = resolvedLanguage
      ? {
          "zh-CN": fonts.chinese,
          ja: fonts.japanese,
          ko: fonts.korean,
          "und-Latn": fonts.latin,
        }[resolvedLanguage]
      : undefined;
    return `${style} ${family ? `${family}, ` : ""}${lyricFont}`;
  };
  /**
   * 展开一组歌词的文本规格，主行始终保留，翻译和音译仅在有内容时生效
   * @param textLine - 原文行，可以是主行或背景行
   * @param styles - 该组使用的样式集
   * @returns 按主行、翻译、音译排列的文本规格
   */
  const specsOf = (textLine: LyricPosterTextLine, styles: StyleSet): TextSpec[] => [
    {
      text: textLine.text,
      style: styles.main,
      language: languageForText(textLine.text, textLine.language),
    },
    ...(textLine.translation ? [{ text: textLine.translation, style: styles.translation }] : []),
    ...(textLine.romaji ? [{ text: textLine.romaji, style: styles.romaji }] : []),
  ];

  /**
   * 测量单段文本的折行结果，语言与字体规则与绘制保持一致
   * @param spec - 文本规格
   * @returns 已折行的文本段
   */
  const measureRow = ({ text, style, language }: TextSpec): MeasuredRow => {
    const font = fontForText(text, style.style, language);
    textContext.lang = language ?? "inherit";
    ctx.font = font;
    const lines = wrapText(ctx, text, CONTENT_WIDTH);
    textContext.lang = "inherit";
    return { lines, font, lang: language ?? "inherit", style };
  };

  /**
   * 测量一组文本，译文与音译折行为空时不占位
   * @param specs - 文本规格，首项为主行
   * @returns 已折行的文本段，首项为主行
   */
  const measureGroup = (specs: TextSpec[]): MeasuredRow[] =>
    specs.map(measureRow).filter((row, index) => index === 0 || row.lines.length > 0);

  /**
   * 计算一组文本高度，主行即使为空也保留一行高度
   * @param rows - 已折行的文本段
   * @returns 高度（像素）
   */
  const groupHeight = (rows: MeasuredRow[]): number =>
    rows.reduce((height, row, index) => {
      const lineCount = index === 0 ? Math.max(1, row.lines.length) : row.lines.length;
      return height + (index > 0 ? row.style.gap : 0) + lineCount * row.style.lineHeight;
    }, 0);

  /**
   * 绘制一组文本，返回绘制结束后的纵坐标
   * @param rows - 已折行的文本段
   * @param textX - 文本锚点横坐标
   * @param startY - 起始纵坐标
   * @returns 绘制结束后的纵坐标
   */
  const drawGroup = (rows: MeasuredRow[], textX: number, startY: number): number => {
    let y = startY;
    rows.forEach((row, index) => {
      if (index > 0) y += row.style.gap;
      ctx.fillStyle = row.style.color;
      textContext.lang = row.lang;
      ctx.font = row.font;
      for (const text of row.lines) {
        ctx.fillText(text, textX, y);
        y += row.style.lineHeight;
      }
      textContext.lang = "inherit";
    });
    return y;
  };

  const title = track.title;
  const artist = track.artists.map((item) => item.name).join(" / ");
  const coverDataUrl = await resolveCoverDataUrl(track);
  const coverImg = coverDataUrl ? await loadImage(coverDataUrl) : null;

  // 字体就绪后再测量，避免首次导出使用回退字体的宽度
  const groups = lines.map((line) => ({
    rows: specsOf(line, LYRIC_STYLES),
    background: line.background?.text ? specsOf(line.background, BG_STYLES) : [],
    duet: !!line.duet,
    backgroundFirst: !!line.backgroundFirst,
  }));
  await Promise.all([
    document.fonts.load(`bold 28px ${globalFont}`, title),
    document.fonts.load(`22px ${globalFont}`, artist),
    document.fonts.load(`600 15px ${globalFont}`, "Made by SPlayer Next"),
    ...groups.flatMap(({ rows, background }) =>
      [...rows, ...background].map((spec) =>
        document.fonts.load(fontForText(spec.text, spec.style.style, spec.language), spec.text),
      ),
    ),
  ]);

  // 预折行并量算高度
  const layout = groups.map((group) => ({
    rows: measureGroup(group.rows),
    background: measureGroup(group.background),
    duet: group.duet,
    backgroundFirst: group.backgroundFirst,
  }));

  let lyricsHeight = 0;
  layout.forEach((block, index) => {
    if (index > 0) lyricsHeight += BLOCK_GAP;
    lyricsHeight += groupHeight(block.rows);
    if (block.background.length) {
      lyricsHeight += BG_GROUP_GAP + groupHeight(block.background);
    }
  });

  const totalHeight =
    PAD_TOP + THUMB + HEADER_GAP + lyricsHeight + WATERMARK_GAP + WATERMARK_H + PAD_BOTTOM;

  // 超长海报降采样，避免超出画布像素上限导致导出空白
  const scale = Math.min(SCALE, MAX_CANVAS_PX / totalHeight);
  canvas.width = WIDTH * scale;
  canvas.height = totalHeight * scale;
  ctx.scale(scale, scale);

  // 底色铺满
  const baseRgb = hexToRgb(fallbackColor || "#14141c");
  const baseSolid = `rgb(${baseRgb})`;
  ctx.fillStyle = baseSolid;
  ctx.fillRect(0, 0, WIDTH, totalHeight);

  if (coverImg) {
    const margin = 80;
    ctx.filter = "blur(70px) saturate(1.2)";
    drawCovered(ctx, coverImg, -margin, -margin, WIDTH + margin * 2, totalHeight + margin * 2);
    ctx.filter = "none";
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, WIDTH, totalHeight);
  }

  // 顶部歌曲信息
  ctx.textBaseline = "top";
  let titleX = PAD_X;
  if (coverImg) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(PAD_X, PAD_TOP, THUMB, THUMB, THUMB_RADIUS);
    ctx.clip();
    drawCovered(ctx, coverImg, PAD_X, PAD_TOP, THUMB, THUMB);
    ctx.restore();
    titleX = PAD_X + THUMB + THUMB_TEXT_GAP;
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 28px ${globalFont}`;
  ctx.fillText(title, titleX, PAD_TOP + 10);
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = `22px ${globalFont}`;
  ctx.fillText(artist, titleX, PAD_TOP + 44);

  // 歌词
  let y = PAD_TOP + THUMB + HEADER_GAP;
  layout.forEach((block, index) => {
    if (index > 0) y += BLOCK_GAP;
    // 对唱行右对齐，其余左对齐
    const textX = block.duet ? WIDTH - PAD_X : PAD_X;
    ctx.textAlign = block.duet ? "right" : "left";
    if (block.backgroundFirst && block.background.length) {
      y = drawGroup(block.background, textX, y);
      y += BG_GROUP_GAP;
    }
    y = drawGroup(block.rows, textX, y);
    if (!block.backgroundFirst && block.background.length) {
      y += BG_GROUP_GAP;
      y = drawGroup(block.background, textX, y);
    }
  });

  // 底部水印（居中）
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.font = `600 15px ${globalFont}`;
  ctx.textAlign = "center";
  ctx.fillText("Made by SPlayer Next", WIDTH / 2, totalHeight - PAD_BOTTOM - WATERMARK_H);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("导出图片失败"))),
      "image/png",
    );
  });
};
