import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SVirtualList from "@/components/ui/SVirtualList.vue";

describe("SVirtualList 分隔条", () => {
  const mountList = () =>
    mount(SVirtualList, {
      props: {
        items: Array.from({ length: 5 }, (_, index) => ({ id: String(index) })),
        itemHeight: 50,
        itemFixed: true,
        separatorIndex: 2,
        separatorHeight: 20,
      },
      slots: {
        default: "<div />",
        separator: '<div data-testid="separator" />',
      },
    });

  it("在指定曲目之前渲染分隔条并把后续曲目下移", () => {
    const wrapper = mountList();

    expect(wrapper.find('[data-testid="separator"]').exists()).toBe(true);
    expect(wrapper.vm.getItemTop(1)).toBe(50);
    expect(wrapper.vm.getItemTop(2)).toBe(120);
    expect(wrapper.vm.getItemTop(3)).toBe(170);
    expect(
      wrapper.find('[data-testid="separator"]').element.parentElement?.getAttribute("style"),
    ).toContain("translateY(100px)");

    wrapper.unmount();
  });

  it("拖拽落点落在分隔条上时归到分隔条后第一首的顶部", () => {
    const wrapper = mountList();

    expect(wrapper.vm.getDropInfoByOffset(105)).toEqual({ index: 2, position: "top" });

    wrapper.unmount();
  });
});
