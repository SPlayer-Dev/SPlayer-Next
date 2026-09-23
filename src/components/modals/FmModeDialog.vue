<script setup lang="ts">
/**
 * 私人 FM 模式与场景选择对话框
 */

import type { PersonalFmMode, PersonalFmSubMode } from "@/types/netease";
import * as player from "@/core/player";
import { useStatusStore } from "@/stores/status";
import { toast } from "@/composables/useToast";

const props = defineProps<{
  /** 是否打开对话框 */
  open: boolean;
}>();

const emit = defineEmits<{
  /** 更新打开状态 */
  "update:open": [value: boolean];
}>();

const { t } = useI18n();
const status = useStatusStore();

/** 主模式定义 */
interface ModeItem {
  key: PersonalFmMode;
  title: string;
  desc: string;
}

const MODES: ModeItem[] = [
  {
    key: "DEFAULT",
    title: "默认模式",
    desc: "沿着目前喜好继续聆听",
  },
  {
    key: "FAMILIAR",
    title: "熟悉模式",
    desc: "喜欢过的歌曲与相似推荐",
  },
  {
    key: "EXPLORE",
    title: "探索模式",
    desc: "偏好曲风与潜力好歌",
  },
  {
    key: "SCENE_RCMD",
    title: "场景模式",
    desc: "根据特定场景与氛围推荐",
  },
];

/** 场景子模式分类与标签 */
interface SubModeCategory {
  category: string;
  items: Array<{ key: PersonalFmSubMode; label: string }>;
}

const SUBMODE_CATEGORIES: SubModeCategory[] = [
  {
    category: "生活场景",
    items: [
      { key: "EXERCISE", label: "运动" },
      { key: "FOCUS", label: "专注" },
      { key: "SLEEP_HELP", label: "助眠" },
      { key: "COMMUTE", label: "出行" },
      { key: "COFFEE_SHOP", label: "咖啡馆" },
      { key: "TAKE_SHOWER", label: "洗澡" },
      { key: "GAMES", label: "游戏" },
    ],
  },
  {
    category: "心情氛围",
    items: [
      { key: "RELAX", label: "放松" },
      { key: "CHEERFUL", label: "欢快" },
      { key: "NIGHT_EMO", label: "伤感" },
      { key: "CURE", label: "治愈" },
      { key: "LYRICAL", label: "抒情" },
      { key: "SWEET", label: "情歌" },
      { key: "INSPIRATIONAL", label: "励志" },
      { key: "RAINY", label: "雨天" },
    ],
  },
  {
    category: "曲风流派",
    items: [
      { key: "GUOFENG", label: "国风" },
      { key: "CHINESE", label: "华语" },
      { key: "ENGLISH", label: "欧美" },
      { key: "YUEYU", label: "粤语" },
      { key: "JAPANESE", label: "日语" },
      { key: "K_POP", label: "K-Pop" },
      { key: "FRANCH", label: "法语" },
      { key: "GLOBAL", label: "全球" },
      { key: "ELECTRONIC", label: "电音" },
      { key: "RAP", label: "说唱" },
      { key: "ROCK", label: "摇滚" },
      { key: "FOLK", label: "民谣" },
      { key: "ACG", label: "二次元" },
      { key: "LIGHT", label: "轻音乐" },
      { key: "JAZZ", label: "爵士" },
      { key: "GUDIAN", label: "古典" },
      { key: "RHYTHM_BLUES", label: "R&B" },
      { key: "BLUE", label: "蓝调" },
      { key: "PUNK", label: "放克" },
      { key: "DANCE", label: "舞蹈" },
      { key: "LATIN", label: "拉丁" },
      { key: "COUNTRY", label: "乡村乐" },
      { key: "MANYAO", label: "慢摇DJ" },
      { key: "JINGDIAN", label: "经典" },
      { key: "ORIGINAL_MUSICIAL", label: "宝藏原创" },
      { key: "MUSICAL", label: "音乐剧" },
      { key: "YINGSHI", label: "影视" },
    ],
  },
];

/** 当前选中的模式 */
const activeMode = ref<PersonalFmMode>("DEFAULT");
/** 当前选中的子场景 */
const activeSubMode = ref<PersonalFmSubMode>("EXERCISE");
/** 是否处于切换中 */
const switching = ref(false);

/** 打开对话框时同步当前正在生效的配置 */
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    const currentOpt = status.fmOptions;
    activeMode.value = currentOpt?.mode ?? "DEFAULT";
    if (currentOpt?.submode) {
      activeSubMode.value = currentOpt.submode;
    }
  },
  { immediate: true },
);

/**
 * 切换模式
 * @param mode - 目标模式
 */
const selectMode = async (mode: PersonalFmMode): Promise<void> => {
  if (switching.value) return;
  activeMode.value = mode;

  if (mode !== "SCENE_RCMD") {
    switching.value = true;
    try {
      const modeLabel = MODES.find((m) => m.key === mode)?.title ?? "私人 FM";
      const ok = await player.playPersonalFm({ mode });
      if (ok) {
        toast.success(`已切换至 「${modeLabel}」`);
        emit("update:open", false);
      } else {
        toast.warning("模式切换失败，请稍后重试");
      }
    } catch {
      toast.warning("模式切换失败，请稍后重试");
    } finally {
      switching.value = false;
    }
  }
};

/**
 * 选中并切换场景
 * @param submode - 目标场景
 * @param label - 场景中文名
 */
const selectSubMode = async (submode: PersonalFmSubMode, label: string): Promise<void> => {
  if (switching.value) return;
  activeMode.value = "SCENE_RCMD";
  activeSubMode.value = submode;

  switching.value = true;
  try {
    const ok = await player.playPersonalFm({
      mode: "SCENE_RCMD",
      submode,
    });
    if (ok) {
      toast.success(`已切换至 「${label}」场景`);
      emit("update:open", false);
    } else {
      toast.warning("场景切换失败，请稍后重试");
    }
  } catch {
    toast.warning("场景切换失败，请稍后重试");
  } finally {
    switching.value = false;
  }
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('player.fm.modeSettings')"
    width="540px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-5 py-1">
      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-on-surface-variant">推荐模式</span>
        <div class="grid grid-cols-2 gap-2.5">
          <SCard
            v-for="item in MODES"
            :key="item.key"
            size="small"
            variant="settings"
            hoverable
            :selected="activeMode === item.key"
            class="flex flex-col gap-0.5"
            @click="selectMode(item.key)"
          >
            <div
              class="text-sm font-medium"
              :class="activeMode === item.key ? 'text-primary' : 'text-on-surface'"
            >
              {{ item.title }}
            </div>
            <div class="text-xs text-on-surface-variant">
              {{ item.desc }}
            </div>
          </SCard>
        </div>
      </div>

      <!-- 场景分类与标签 -->
      <div class="flex flex-col gap-3">
        <span class="text-xs font-medium text-on-surface-variant">场景与风格</span>

        <div class="flex flex-col gap-4 max-h-[300px] overflow-y-auto pr-1">
          <div v-for="cat in SUBMODE_CATEGORIES" :key="cat.category" class="flex flex-col gap-2">
            <span class="text-xs text-on-surface-variant/60 font-medium px-0.5">
              {{ cat.category }}
            </span>
            <div class="flex flex-wrap gap-2">
              <STag
                v-for="sub in cat.items"
                :key="sub.key"
                round
                size="medium"
                :type="
                  activeMode === 'SCENE_RCMD' && activeSubMode === sub.key ? 'primary' : 'default'
                "
                :variant="
                  activeMode === 'SCENE_RCMD' && activeSubMode === sub.key ? 'filled' : 'soft'
                "
                class="cursor-pointer"
                :class="switching ? 'opacity-70 pointer-events-none' : ''"
                @click="selectSubMode(sub.key, sub.label)"
              >
                {{ sub.label }}
              </STag>
            </div>
          </div>
        </div>
      </div>
    </div>
  </SDialog>
</template>
