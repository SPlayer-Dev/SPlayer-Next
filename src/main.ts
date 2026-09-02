import "virtual:uno.css";
import "@/styles/global.css";

import piniaPersistedstate from "pinia-plugin-persistedstate";
import App from "./App.vue";
import router from "./router";
import i18n from "./i18n";

import { useThemeStore } from "./stores/theme";
import { useSettingsStore } from "./stores/settings";
import { useHotkeyStore } from "./stores/hotkey";
import { initPlayer, playFiles, restoreLastTrack } from "./core/player";
import { handleOrpheus } from "./services/orpheus";
import { installHotkeyManager } from "./core/hotkey/manager";
import { vRipple } from "./directives/ripple";
import { HOTKEY_ACTIONS } from "@shared/defaults/hotkeys";

const pinia = createPinia();
pinia.use(piniaPersistedstate);

const app = createApp(App);
app.directive("ripple", vRipple);
app.use(pinia);
app.use(router);
app.use(i18n);

// 初始化主题
useThemeStore().init();

/** 将当前语言的快捷键描述上报给主进程（portal 绑定展示用） */
const syncPortalDescriptions = (): void => {
  const descriptions: Record<string, string> = {};
  for (const action of HOTKEY_ACTIONS) {
    if (!action.allowGlobal) continue;
    descriptions[action.id] = i18n.global.t(action.labelKey);
  }
  void window.api.hotkey.setPortalDescriptions(descriptions);
};

// 同步语言设置
watch(
  () => useSettingsStore().locale,
  (v) => {
    i18n.global.locale.value = v;
    window.api.system.setLocale(v);
    syncPortalDescriptions();
  },
  { immediate: true },
);

/** splash 笔画动画总时长（ms） */
const SPLASH_ANIM_MS = 2050;

/** 标记 splash 定时器是否已触发 */
let splashTimerFired = false;

/** 移除 splash 层 */
const removeSplash = (): void => {
  const el = document.getElementById("app-loading");
  if (!el) return;
  el.classList.add("hidden");
  el.addEventListener("transitionend", () => el.remove(), { once: true });
};

/** 挂载后移除 */
const onSplashTimerDone = (): void => {
  splashTimerFired = true;
  removeSplash();
};

/**
 * 启动播放服务并分发冷启动任务
 */
const bootstrapPlayback = async (): Promise<void> => {
  await initPlayer();

  const pendingAudioFiles = await window.api.system.consumePendingAudioFiles();
  const pendingOrpheusUrl = await window.api.system.consumePendingProtocolUrl();

  if (pendingAudioFiles && pendingAudioFiles.length > 0) {
    await playFiles(pendingAudioFiles);
  } else if (pendingOrpheusUrl) {
    await handleOrpheus(pendingOrpheusUrl);
  } else {
    await restoreLastTrack();
  }
};

// 初始化程序
router.isReady().then(() => {
  // 挂载应用
  app.mount("#app");
  // 计算剩余时间
  const elapsed = performance.now() - (window.__splashStart ?? 0);
  const remaining = Math.max(0, SPLASH_ANIM_MS - elapsed);
  setTimeout(onSplashTimerDone, remaining);
  if (!splashTimerFired) {
    setTimeout(removeSplash, SPLASH_ANIM_MS + 100);
  }
  // 初始化播放器与冷启动分发
  bootstrapPlayback().catch(console.error);
  // 初始化快捷键
  useHotkeyStore()
    .init()
    .then(installHotkeyManager)
    .catch((err) => console.error("[hotkey] init failed", err));
});
