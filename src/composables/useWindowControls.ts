import { dialog } from "@/composables/useDialog";
import { useSettingsStore } from "@/stores/settings";
import SRadio from "@/components/ui/SRadio.vue";
import SCheckbox from "@/components/ui/SCheckbox.vue";

/** 主窗口控制 */
export const useWindowControls = () => {
  const { t } = useI18n();
  const settings = useSettingsStore();

  const isMaximized = ref(false);
  const isFullscreen = ref(false);

  const minimize = (): void => window.api.window.minimize();
  const toggleMaximize = (): void => window.api.window.toggleMaximize();
  const toggleFullscreen = (): void => window.api.window.toggleFullscreen();
  const hide = (): void => window.api.window.hide();
  const quit = (): void => window.api.window.quit();

  /** 点击关闭：已记忆走设置，未记忆弹窗询问 */
  const close = async (): Promise<void> => {
    const { appearance } = settings;
    if (appearance.rememberCloseChoice) {
      appearance.closeAction === "hide" ? hide() : quit();
      return;
    }
    const choice = ref<"quit" | "hide">(appearance.closeAction);
    const remember = ref(false);
    const confirmed = await dialog.confirm({
      title: t("settings.closeDialog.title"),
      description: t("settings.closeDialog.description"),
      body: () =>
        h("div", { class: "flex flex-col gap-4" }, [
          h("div", { class: "flex flex-col gap-3" }, [
            h(SRadio, {
              checked: choice.value === "quit",
              label: t("settings.closeDialog.quit"),
              onChange: () => (choice.value = "quit"),
            }),
            h(SRadio, {
              checked: choice.value === "hide",
              label: t("settings.closeDialog.hide"),
              onChange: () => (choice.value = "hide"),
            }),
          ]),
          h(SCheckbox, {
            checked: remember.value,
            label: t("settings.closeDialog.remember"),
            "onUpdate:checked": (v: boolean) => (remember.value = v),
          }),
        ]),
    });
    if (!confirmed) return;
    if (remember.value) {
      appearance.closeAction = choice.value;
      appearance.rememberCloseChoice = true;
    }
    choice.value === "hide" ? hide() : quit();
  };

  onMounted(() => {
    window.api.window.isMaximized().then((m) => (isMaximized.value = m));
    window.api.window.isFullscreen().then((f) => (isFullscreen.value = f));
    const offMax = window.api.window.onMaximizeChange((m) => (isMaximized.value = m));
    const offFs = window.api.window.onFullscreenChange((f) => (isFullscreen.value = f));
    onBeforeUnmount(() => {
      offMax();
      offFs();
    });
  });

  return {
    isMaximized,
    isFullscreen,
    minimize,
    toggleMaximize,
    toggleFullscreen,
    hide,
    quit,
    close,
  };
};
