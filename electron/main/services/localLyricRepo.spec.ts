import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const mocks = vi.hoisted(() => ({
  enabled: true,
  dirs: [] as string[],
  matched: null as { platformId: string; extra?: { mid?: string } } | null,
}));

vi.mock("@main/store", () => ({
  store: {
    get: (keyPath: string) => {
      if (keyPath === "localLyric.enableLocalLyricOverride") return mocks.enabled;
      if (keyPath === "localLyric.repoDirs") return mocks.dirs;
      return undefined;
    },
  },
}));
vi.mock("@main/utils/logger", () => ({ coreLog: { info: () => {}, warn: () => {} } }));
vi.mock("@main/database/lyricMatchCache", () => ({
  buildFingerprint: () => "fingerprint",
  getMatchedId: () => mocks.matched,
}));

import { matchLocalLyric } from "./localLyricRepo";

const track = (patch: Partial<Track> = {}): Track =>
  ({
    id: "1",
    title: "未收录的歌",
    artists: [{ name: "未知歌手" }],
    source: "netease",
    ...patch,
  }) as Track;

const tempDirs: string[] = [];

const makeDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "local-lyric-"));
  tempDirs.push(dir);
  return dir;
};

const write = async (file: string, content: string): Promise<void> => {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf-8");
};

describe("本地歌词库匹配", () => {
  beforeEach(() => {
    mocks.enabled = true;
    mocks.dirs = [];
    mocks.matched = null;
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("递归子目录里按文件名中的歌曲 ID 命中", async () => {
    const dir = await makeDir();
    await write(join(dir, "收藏", "任意前缀.123.lrc"), "[00:01.00]本地歌词");
    mocks.dirs = [dir];
    await expect(matchLocalLyric(track({ id: "123" }))).resolves.toContain("本地歌词");
  });

  it("同 ID 多格式时取格式优先级最高的 TTML", async () => {
    const dir = await makeDir();
    await write(join(dir, "123.lrc"), "[00:01.00]lrc 歌词");
    await write(join(dir, "123.ttml"), "<ttml>ttml 歌词</ttml>");
    mocks.dirs = [dir];
    await expect(matchLocalLyric(track({ id: "123" }))).resolves.toContain("ttml 歌词");
  });

  it("LRC 的 [ti:] / [ar:] 标签参与标题匹配", async () => {
    const dir = await makeDir();
    await write(join(dir, "自校歌词.lrc"), "[ti:夜曲]\n[ar:周杰伦]\n[00:01.00]本地歌词");
    mocks.dirs = [dir];
    const target = track({ id: "9", title: "夜曲", artists: [{ name: "周杰伦" }] });
    await expect(matchLocalLyric(target)).resolves.toContain("本地歌词");
  });

  it("TTML 的 AMLL 元信息参与匹配", async () => {
    const dir = await makeDir();
    const ttml = [
      "<ttml><head><metadata>",
      '<amll:meta key="musicName" value="夜曲"/>',
      '<amll:meta key="ncmMusicId" value="777"/>',
      "</metadata></head><body></body></ttml>",
    ].join("");
    await write(join(dir, "自校合集.ttml"), ttml);
    mocks.dirs = [dir];
    await expect(matchLocalLyric(track({ id: "777", title: "别的名字" }))).resolves.toContain(
      "ncmMusicId",
    );
  });

  it("TTML 里多个 ncmMusicId 都会进索引", async () => {
    const dir = await makeDir();
    const ttml = [
      "<ttml><head><metadata>",
      '<amll:meta key="musicName" value="夜曲"/>',
      '<amll:meta key="ncmMusicId" value="601"/>',
      '<amll:meta key="ncmMusicId" value="602"/>',
      "</metadata></head><body></body></ttml>",
    ].join("");
    await write(join(dir, "自校合集.ttml"), ttml);
    mocks.dirs = [dir];
    await expect(matchLocalLyric(track({ id: "602", title: "别的名字" }))).resolves.toContain(
      "ncmMusicId",
    );
  });

  it("多个目录时靠前的目录优先", async () => {
    const first = await makeDir();
    const second = await makeDir();
    await write(join(first, "8.lrc"), "[00:01.00]第一目录");
    await write(join(second, "8.lrc"), "[00:01.00]第二目录");
    mocks.dirs = [first, second];
    await expect(matchLocalLyric(track({ id: "8" }))).resolves.toContain("第一目录");
  });

  it("开关关闭时不读取歌词文件", async () => {
    const dir = await makeDir();
    await write(join(dir, "5.lrc"), "[00:01.00]本地歌词");
    mocks.dirs = [dir];
    mocks.enabled = false;
    await expect(matchLocalLyric(track({ id: "5" }))).resolves.toBeNull();
  });

  it("根目录新增文件后重建索引", async () => {
    const dir = await makeDir();
    mocks.dirs = [dir];
    await expect(matchLocalLyric(track({ id: "42" }))).resolves.toBeNull();
    await write(join(dir, "42.lrc"), "[00:01.00]后来添加的");
    await expect(matchLocalLyric(track({ id: "42" }))).resolves.toContain("后来添加的");
  });

  it("子目录新增文件后重建索引", async () => {
    const dir = await makeDir();
    const sub = join(dir, "收藏");
    await mkdir(sub, { recursive: true });
    mocks.dirs = [dir];
    await expect(matchLocalLyric(track({ id: "42" }))).resolves.toBeNull();
    // 只写入子目录，父目录 mtime 不变，靠目录树签名发现变化
    await write(join(sub, "42.lrc"), "[00:01.00]子目录后来添加的");
    await expect(matchLocalLyric(track({ id: "42" }))).resolves.toContain("子目录后来添加的");
  });

  it("构建途中更换目录集合时按新集合返回", async () => {
    const first = await makeDir();
    const second = await makeDir();
    await write(join(second, "66.lrc"), "[00:01.00]第二目录");
    mocks.dirs = [first];
    const stale = matchLocalLyric(track({ id: "66" }));
    mocks.dirs = [second];
    const fresh = matchLocalLyric(track({ id: "66" }));
    await expect(fresh).resolves.toContain("第二目录");
    await expect(stale).resolves.toBeNull();
  });

  it("QQ 的 songmid 不参与文件名匹配，数字 songId 仍可命中", async () => {
    const dir = await makeDir();
    await write(join(dir, "0039MnYb0qxYhV.lrc"), "[00:01.00]mid 命名");
    await write(join(dir, "7531681.lrc"), "[00:01.00]数字命名");
    mocks.dirs = [dir];
    // QQ 音乐 Track 的 id 是 songmid、extId 是数字 songId
    const byMid = track({ id: "0039MnYb0qxYhV", source: "qqmusic", title: "无题", artists: [] });
    await expect(matchLocalLyric(byMid)).resolves.toBeNull();
    const byNumeric = track({
      id: "0039MnYb0qxYhV",
      extId: "7531681",
      source: "qqmusic",
      title: "无题",
      artists: [],
    });
    await expect(matchLocalLyric(byNumeric)).resolves.toContain("数字命名");
  });

  it("平台 ID 与标题都没命中时用匹配缓存回查", async () => {
    const dir = await makeDir();
    await write(join(dir, "314.lrc"), "[00:01.00]缓存回查命中");
    mocks.dirs = [dir];
    mocks.matched = { platformId: "314" };
    await expect(matchLocalLyric(track({ id: "0" }))).resolves.toContain("缓存回查命中");
  });
});
