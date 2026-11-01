/**
 * 将服务端毫秒时间转换成 LRC，偏移直接应用于时间轴，避免解析器差异
 * @param lines - 服务端歌词行
 * @param synced - 是否有时间轴
 * @param offset - 正值提前的服务端偏移
 * @returns 歌词文本
 */
export const toStreamingLyrics = (
  lines: { text: string; start: number }[],
  synced: boolean,
  offset = 0,
): string | null => {
  if (!lines.length) return null;
  return lines
    .map((line) => {
      if (!synced) return line.text;
      const ms = Math.max(0, line.start - offset);
      const minutes = Math.floor(ms / 60_000);
      const seconds = Math.floor(ms / 1000) % 60;
      const fraction = Math.floor(ms % 1000);
      return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(3, "0")}]${line.text}`;
    })
    .join("\n");
};
