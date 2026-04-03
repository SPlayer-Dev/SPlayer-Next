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
      routeTransition: "fade",
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

    /** 系统配置 - 传递主进程 */
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
      // 后处理
      if (keyPath === "player.fadeEnabled" || keyPath === "player.fadeDuration") {
        await window.api.player.setFadeDuration(system.player.fadeEnabled ? system.player.fadeDuration : 0);
      }
    };

    /** 本地配置写入后处理 */
    const afterLocalChange = (path: string, value: unknown): void => {
      if (path === "lyric.springPreset" && value !== "custom") {
        const params = SPRING_PRESETS[value as Exclude<SpringPreset, "custom">];
        lyric.springMass = params.mass;
        lyric.springDamping = params.damping;
        lyric.springStiffness = params.stiffness;
      }
    };

    return {
      locale,
      player,
      lyric,
      system,
      syncSystem,
      setSystem,
      afterLocalChange,
    };
  },
  {
    persist: {
      storage: localStorage,
      omit: ["system"],
    },
  },
);
