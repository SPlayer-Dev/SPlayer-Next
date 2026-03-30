import type { PlayerSettings, LyricSettings, SpringPreset } from "@/types/settings";
import { SPRING_PRESETS } from "@/types/settings";
import type { LocaleCode } from "@/i18n";
import type { SystemConfig } from "@shared/types/settings";
import { defaultSystemConfig } from "@shared/defaults/settings";

export const useSettingsStore = defineStore(
  "settings",
  () => {
    /** 界面语言（持久化，由 main.ts 同步到 vue-i18n） */
    const locale = ref<LocaleCode>("zh-CN");

    /** 播放器设置（持久化） */
    const player = reactive<PlayerSettings>({
      playerBgType: "blur",
      autoCenterCover: true,
      followCoverColor: true,
      layoutMode: "default",
    });

    /** 歌词设置（持久化） */
    const lyric = reactive<LyricSettings>({
      lyricMode: "effects",
      adaptiveFontSize: true,
      fontSize: 48,
      fontWeight: 700,
      showTranslation: true,
      showRomanization: true,
      enableWordHighlight: true,
      enableFloatAnimation: false,
      enableEmphasizeEffect: false,
      enableBlur: false,
      hidePassedLines: false,
      springPreset: "default",
      springMass: 0.9,
      springDamping: 15,
      springStiffness: 90,
      alignPosition: 0.35,
      wordFadeWidth: 0.5,
      inactiveAlpha: 0.2,
    });

    /** 选择弹簧预设时自动填充参数 */
    watch(
      () => lyric.springPreset,
      (preset: SpringPreset) => {
        if (preset === "custom") return;
        const params = SPRING_PRESETS[preset];
        lyric.springMass = params.mass;
        lyric.springDamping = params.damping;
        lyric.springStiffness = params.stiffness;
      },
    );

    /** 手动修改弹簧参数时自动切换为自定义预设 */
    watch(
      () => [lyric.springMass, lyric.springDamping, lyric.springStiffness],
      ([mass, damping, stiffness]) => {
        if (lyric.springPreset === "custom") return;
        const params = SPRING_PRESETS[lyric.springPreset];
        if (mass !== params.mass || damping !== params.damping || stiffness !== params.stiffness) {
          lyric.springPreset = "custom";
        }
      },
    );

    /** 后端配置（不持久化，从主进程同步） */
    const system = reactive<SystemConfig>(structuredClone(defaultSystemConfig));

    /** 从主进程拉取后端配置 */
    const syncSystem = async (): Promise<void> => {
      try {
        Object.assign(system, await window.api.config.getAll());
      } catch {}
    };

    /** 写入后端配置并更新本地 */
    const setSystem = async (keyPath: string, value: unknown): Promise<void> => {
      await window.api.config.set(keyPath, value);
      await syncSystem();
    };

    return {
      locale,
      player,
      lyric,
      system,
      syncSystem,
      setSystem,
    };
  },
  {
    persist: {
      storage: localStorage,
      omit: ["system"],
    },
  },
);
