import type { Track } from "@shared/types/player";

/** 海报中的一行歌词 */
export interface LyricPosterLine {
  text: string;
  /** 翻译，存在即绘制 */
  translation?: string;
  /** 音译，存在即绘制 */
  romaji?: string;
}

export interface LyricPosterOptions {
  track: Track;
  lines: LyricPosterLine[];
  /** 无封面时的背景色 HEX，可空 */
  fallbackColor?: string | null;
}

const SCALE = 3;
const MAX_CANVAS_PX = 16000;
const WIDTH = 720;
const RADIUS = 36;
const PAD_X = 56;
const PAD_TOP = 64;
const PAD_BOTTOM = 30;

const FONT_STACK = '-apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const LYRIC_FONT = `bold 34px ${FONT_STACK}`;
const TRANS_FONT = `24px ${FONT_STACK}`;
const ROMAJI_FONT = `italic 22px ${FONT_STACK}`;
const TITLE_FONT = `bold 28px ${FONT_STACK}`;
const ARTIST_FONT = `22px ${FONT_STACK}`;
const MARK_FONT = `600 15px ${FONT_STACK}`;

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

/** 内容区宽度 */
const CONTENT_WIDTH = WIDTH - PAD_X * 2;

/** Blob 转 dataURL */
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** 把当前曲目封面解析为 dataURL，供 canvas 同源使用（绕开跨域污染） */
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
 * @param options - 曲目、歌词行、无封面时的背景色
 * @returns PNG Blob
 */
export const createLyricPoster = async (options: LyricPosterOptions): Promise<Blob> => {
  const { track, lines, fallbackColor } = options;
  const title = track.title;
  const artist = track.artists.map((item) => item.name).join(" / ");
  const coverDataUrl = await resolveCoverDataUrl(track);
  const coverImg = coverDataUrl ? await loadImage(coverDataUrl) : null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");

  // 预折行并量算高度
  const layout = lines.map((line) => {
    ctx.font = LYRIC_FONT;
    const main = wrapText(ctx, line.text || " ", CONTENT_WIDTH);
    ctx.font = TRANS_FONT;
    const translation = line.translation ? wrapText(ctx, line.translation, CONTENT_WIDTH) : [];
    ctx.font = ROMAJI_FONT;
    const romaji = line.romaji ? wrapText(ctx, line.romaji, CONTENT_WIDTH) : [];
    return { main, translation, romaji };
  });

  let lyricsHeight = 0;
  layout.forEach((block, index) => {
    if (index > 0) lyricsHeight += BLOCK_GAP;
    lyricsHeight += Math.max(1, block.main.length) * LYRIC_LH;
    if (block.translation.length) lyricsHeight += SUBLINE_GAP + block.translation.length * TRANS_LH;
    if (block.romaji.length) lyricsHeight += SUBLINE_GAP + block.romaji.length * ROMAJI_LH;
  });

  const totalHeight =
    PAD_TOP + THUMB + HEADER_GAP + lyricsHeight + WATERMARK_GAP + WATERMARK_H + PAD_BOTTOM;

  // 超长海报降采样，避免超出画布像素上限导致导出空白
  const scale = Math.min(SCALE, MAX_CANVAS_PX / totalHeight);
  canvas.width = WIDTH * scale;
  canvas.height = totalHeight * scale;
  ctx.scale(scale, scale);

  // 圆角裁剪
  ctx.beginPath();
  ctx.roundRect(0, 0, WIDTH, totalHeight, RADIUS);
  ctx.clip();

  // 背景
  if (coverImg) {
    const margin = 80;
    ctx.filter = "blur(45px) saturate(1.2)";
    drawCovered(ctx, coverImg, -margin, -margin, WIDTH + margin * 2, totalHeight + margin * 2);
    ctx.filter = "none";
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, WIDTH, totalHeight);
  } else {
    ctx.fillStyle = fallbackColor || "#14141c";
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
  ctx.font = TITLE_FONT;
  ctx.fillText(title, titleX, PAD_TOP + 10);
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = ARTIST_FONT;
  ctx.fillText(artist, titleX, PAD_TOP + 44);

  // 歌词
  let y = PAD_TOP + THUMB + HEADER_GAP;
  layout.forEach((block, index) => {
    if (index > 0) y += BLOCK_GAP;
    ctx.fillStyle = "#ffffff";
    ctx.font = LYRIC_FONT;
    for (const text of block.main) {
      ctx.fillText(text, PAD_X, y);
      y += LYRIC_LH;
    }
    if (block.translation.length) {
      y += SUBLINE_GAP;
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.font = TRANS_FONT;
      for (const text of block.translation) {
        ctx.fillText(text, PAD_X, y);
        y += TRANS_LH;
      }
    }
    if (block.romaji.length) {
      y += SUBLINE_GAP;
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.font = ROMAJI_FONT;
      for (const text of block.romaji) {
        ctx.fillText(text, PAD_X, y);
        y += ROMAJI_LH;
      }
    }
  });

  // 底部水印（居中）
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.font = MARK_FONT;
  ctx.textAlign = "center";
  ctx.fillText("Made by SPlayer Next", WIDTH / 2, totalHeight - PAD_BOTTOM - WATERMARK_H);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("导出图片失败"))),
      "image/png",
    );
  });
};
