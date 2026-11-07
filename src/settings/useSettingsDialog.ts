import { useStatusStore } from "@/stores/status";

const open = ref(false);
const initialCategory = ref("general");
const initialHighlight = ref<string>();
const initialParentKeys = ref<string[]>([]);

/**
 * 设置弹窗控制
 * 全局单例，任何组件都可调用 show() 打开设置
 */
export const useSettingsDialog = () => ({
  open,
  initialCategory,
  initialHighlight,
  initialParentKeys,

  /**
   * 打开设置弹窗
   * @param category - 本次定向到的分类
   * @param highlight - 需高亮定位的设置项 key
   * @param parentKeys - 高亮项从外到内的父项键名，子项收起时回退定位父项
   */
  show: (category?: string, highlight?: string, parentKeys: string[] = []) => {
    initialCategory.value = category ?? (useStatusStore().settingsCategory || "general");
    initialHighlight.value = highlight;
    initialParentKeys.value = parentKeys;
    open.value = true;
  },

  /** 关闭设置弹窗 */
  hide: () => {
    open.value = false;
  },

  /** 记忆用户手动选择的大分类 */
  rememberCategory: (category: string) => {
    useStatusStore().settingsCategory = category;
  },
});
