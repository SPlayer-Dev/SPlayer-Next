/**
 * 读取系统已安装字体
 */

/** 系统字体列表 */
const families = ref<string[]>([]);
/** 是否正在加载字体列表 */
const loading = ref(false);
/** 进行中的拉取任务 */
let pending: Promise<void> | null = null;

/** 拉取系统字体并去重排序 */
const fetchFamilies = async (): Promise<string[]> => {
  const list = await window.api.system.listFonts();
  const unique = Array.from(new Set(list.filter((f) => f.trim().length > 0)));
  unique.sort((a, b) => a.localeCompare(b, "zh-CN"));
  return unique;
};

/** 使用系统字体 */
export const useSystemFonts = () => {
  /** 仅首次拉取，之后复用缓存 */
  const ensureLoaded = (): Promise<void> => {
    if (families.value.length > 0) return Promise.resolve();
    if (pending) return pending;
    loading.value = true;
    pending = fetchFamilies()
      .then((list) => {
        families.value = list;
      })
      .catch((err) => {
        console.error("[fonts] listFonts failed", err);
      })
      .finally(() => {
        loading.value = false;
        pending = null;
      });
    return pending;
  };

  return { families, loading, ensureLoaded };
};
