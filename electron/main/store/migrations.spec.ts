import { describe, expect, it } from "vitest";
import { defaultSystemConfig } from "@shared/defaults/settings";
import type { SystemConfig } from "@shared/types/settings";
import { migrations } from "./migrations";

/** 还原老版本 settings.json 经 deepMerge 后的形态：新键取默认值，另有单目录与旧开关 */
const legacyConfig = (repoDir: string, enabled: boolean): SystemConfig => {
  const data = structuredClone(defaultSystemConfig);
  const localLyric = data.localLyric as unknown as Record<string, unknown>;
  localLyric.repoDir = repoDir;
  localLyric.enableLocalTTMLOverride = enabled;
  return data;
};

const migrateToLatest = (data: SystemConfig): void => {
  for (const migration of migrations.filter((m) => m.version > 0)) migration.migrate(data);
};

describe("配置迁移", () => {
  it("version 1 把单目录与旧开关搬到多目录新键", () => {
    const data = legacyConfig("D:\\Lyrics", true);
    migrateToLatest(data);
    expect(data.localLyric.repoDirs).toEqual(["D:\\Lyrics"]);
    expect(data.localLyric.enableLocalLyricOverride).toBe(true);
    expect("repoDir" in data.localLyric).toBe(false);
    expect("enableLocalTTMLOverride" in data.localLyric).toBe(false);
  });

  it("未设置过歌词库目录时迁移为空列表", () => {
    const data = legacyConfig("", false);
    migrateToLatest(data);
    expect(data.localLyric.repoDirs).toEqual([]);
    expect(data.localLyric.enableLocalLyricOverride).toBe(false);
    expect("repoDir" in data.localLyric).toBe(false);
  });
});
