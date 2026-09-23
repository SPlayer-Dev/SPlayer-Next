import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seek = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@/core/player", () => ({ seek }));

import { useStatusStore } from "@/stores/status";
import { checkLoop, reset, setA, setB, setEnabled } from "./abLoop";

describe("abLoop", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    seek.mockClear();
  });

  it("只有 A、B 合法且 B 大于 A 时才能启用", () => {
    const status = useStatusStore();

    setEnabled(true);
    expect(status.abLoop.enable).toBe(false);

    setA(2_000.9);
    setB(1_000);
    setEnabled(true);
    expect(status.abLoop.enable).toBe(false);

    setB(3_000.9);
    setEnabled(true);
    expect(status.abLoop).toEqual({ enable: true, pointA: 2_000, pointB: 3_000 });
  });

  it("到达 B 点时跳回 A 点且不会提前触发", () => {
    setA(1_000);
    setB(2_000);
    setEnabled(true);

    checkLoop(1_999);
    expect(seek).not.toHaveBeenCalled();

    checkLoop(2_000);
    expect(seek).toHaveBeenCalledOnce();
    expect(seek).toHaveBeenCalledWith(1_000);
  });

  it("切歌重置会清空 AB 循环状态", () => {
    const status = useStatusStore();
    setA(1_000);
    setB(2_000);
    setEnabled(true);

    reset();

    expect(status.abLoop).toEqual({ enable: false, pointA: null, pointB: null });
  });
});
