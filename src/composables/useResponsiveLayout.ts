import { useSettingsStore } from "@/stores/settings";

/** 内容区进入紧凑布局的视口宽度 */
const COMPACT_QUERY = "(max-width: 1023.98px)";
/** 侧栏自动折叠的视口宽度 */
const SIDEBAR_QUERY = "(max-width: 1199.98px)";

/**
 * 应用级响应式布局状态
 * @returns 紧凑布局标记与侧栏有效折叠状态
 */
export const useResponsiveLayout = () => {
  const settings = useSettingsStore();
  const isCompact = useMediaQuery(COMPACT_QUERY);
  const isNarrow = useMediaQuery(SIDEBAR_QUERY);

  /** 窄窗口强制折叠侧栏，避免主内容区被持续挤压 */
  const sidebarCollapsed = computed(() => settings.appearance.sidebarCollapsed || isNarrow.value);

  return { isCompact, isNarrow, sidebarCollapsed };
};
