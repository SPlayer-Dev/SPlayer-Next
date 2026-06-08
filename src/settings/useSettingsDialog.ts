import { settingsSchema } from "@/settings/schema";
import { useStatusStore } from "@/stores/status";

const open = ref(false);
const initialCategory = ref(settingsSchema[0].id);
const initialHighlight = ref<string>();

/**
 * 设置弹窗控制
 * 全局单例，任何组件都可调用 show() 打开设置
 */
export const useSettingsDialog = () => ({
  open,
  initialCategory,
  initialHighlight,

  /**
   * 打开设置弹窗
   * @param category - 本次定向到的分类
   * @param highlight - 需高亮定位的设置项 key
   */
  show: (category?: string, highlight?: string) => {
    initialCategory.value = category ?? (useStatusStore().settingsCategory || settingsSchema[0].id);
    initialHighlight.value = highlight;
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
