import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import SVirtualList from "./SVirtualList.vue";

vi.mock("@vueuse/core", () => ({
  useElementSize: () => ({ height: ref(240) }),
  useDebounceFn: (fn: () => void) => fn,
}));

describe("虚拟列表精确行高", () => {
  it("按标题和歌曲的不同高度计算偏移、总高和定位", async () => {
    const wrapper = mount(SVirtualList, {
      props: {
        items: ["disc", "song", "song", "disc", "song"],
        itemHeight: 88,
        itemFixed: true,
        getItemHeight: (item) => (item === "disc" ? 40 : 88),
      },
      slots: { default: "<div>{{ params.item }}</div>" },
    });
    await wrapper.vm.$nextTick();
    expect([0, 1, 2, 3, 4].map((index) => wrapper.vm.getItemTop(index))).toEqual([
      0, 40, 128, 216, 256,
    ]);
    expect(wrapper.html()).toContain("height: 344px");
    const scrollTo = vi.fn();
    wrapper.vm.scrollRef!.scrollTo = scrollTo;
    wrapper.vm.scrollToIndex(4);
    expect(scrollTo).toHaveBeenCalledWith({ top: 256, behavior: "auto" });
    expect(wrapper.vm.getDropInfoByOffset(230)).toEqual({ index: 3, position: "top" });
    expect(wrapper.vm.getDropInfoByOffset(245)).toEqual({ index: 3, position: "bottom" });

    await wrapper.setProps({ items: ["disc", "song"] });
    expect(wrapper.vm.getItemTop(1)).toBe(40);
    expect(wrapper.html()).toContain("height: 128px");
    wrapper.unmount();
  });

  it("切换紧凑样式或恢复普通等高列表时重新计算位置", async () => {
    const songHeight = ref(88);
    const wrapper = mount(SVirtualList, {
      props: {
        items: ["disc", "song", "song"],
        itemHeight: songHeight.value,
        itemFixed: true,
        getItemHeight: (item) => (item === "disc" ? 40 : songHeight.value),
      },
    });
    songHeight.value = 56;
    await wrapper.setProps({ itemHeight: songHeight.value });
    expect(wrapper.vm.getItemTop(2)).toBe(96);
    expect(wrapper.html()).toContain("height: 152px");
    await wrapper.setProps({ getItemHeight: undefined });
    expect(wrapper.vm.getItemTop(2)).toBe(112);
    expect(wrapper.html()).toContain("height: 168px");
    wrapper.unmount();
  });
});
