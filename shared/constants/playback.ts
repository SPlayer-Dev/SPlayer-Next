import type { TransitionPreference } from "@shared/types/player";

/** 按墙钟时间提前安排交接，包含原生检测窗口和提交余量。 */
export const TRANSITION_LOOKAHEAD_MS: Record<TransitionPreference, number> = {
  conservative: 5000,
  standard: 6000,
  eager: 9000,
};
