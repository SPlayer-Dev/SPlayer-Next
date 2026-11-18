import { describe, expect, it } from "vitest";
import { normalizeQMSong } from "./song";

describe("QM 歌曲归一化脏标", () => {
  it("从 title_extra 识别 Explicit 并剥离标题后缀", () => {
    const song = normalizeQMSong({
      id: 254688207,
      mid: "0028ffYY0yoeRH",
      name: "Lose Yourself",
      title: "Lose Yourself (Explicit)",
      title_extra: " (Explicit)",
      interval: 320,
    });

    expect(song.name).toBe("Lose Yourself");
    expect(song.explicit).toBe(true);
  });

  it("title_extra 缺失时仍识别标题内的 Explicit 后缀", () => {
    const song = normalizeQMSong({ id: 1, title: "Without Me (Explicit)" });

    expect(song.name).toBe("Without Me");
    expect(song.explicit).toBe(true);
  });

  it("title_extra 为脏标时不剥离不含后缀的标题", () => {
    const song = normalizeQMSong({
      id: 1,
      name: "Lose Yourself",
      title_extra: " (Explicit)",
    });

    expect(song.name).toBe("Lose Yourself");
    expect(song.explicit).toBe(true);
  });

  it("普通歌曲不设置脏标", () => {
    const song = normalizeQMSong({ id: 1, name: "晴天" });

    expect(song.name).toBe("晴天");
    expect(song.explicit).toBeUndefined();
  });
});
