/** 显示启动层并在首屏就绪后移交播放控制，避免静态导入 Vue 或业务模块 */
export const bootstrap = async (): Promise<void> => {
  const splash = document.getElementById("app-loading")!;
  const root = document.getElementById("app")!;
  const logo = splash.querySelector<HTMLImageElement>(".splash-logo")!;
  /** 跟随页面可见性暂停启动动画 */
  const syncVisibility = (): void => {
    splash.classList.toggle("paused", document.hidden);
  };
  document.addEventListener("visibilitychange", syncVisibility);
  syncVisibility();

  try {
    await Promise.allSettled([document.fonts.load('36px "logo"'), logo.decode()]);
    await window.api.window.ready();
    splash.classList.add("started");
    // 只等待有限入场动画，循环圆点不参与就绪判定。
    const entrance = Promise.allSettled(
      Array.from(splash.querySelectorAll(".entrance")).flatMap((element) =>
        element.getAnimations().map((animation) => animation.finished),
      ),
    );
    // 先提交动画首帧，再解析业务模块，避免热缓存下模块求值抢占入场。
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const application = await import("./main");
    await Promise.all([application.mountApplication(), entrance]);
    // Vue 更新完成不代表浏览器已布局，保留一帧让底层界面完成绘制。
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const fade = splash.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200,
      easing: "ease-out",
      fill: "forwards",
    });
    await fade.finished;
    splash.remove();
    fade.cancel();
    root.inert = false;
    root.removeAttribute("aria-hidden");
    await window.api.window.startupComplete();
    application.startApplication();
  } finally {
    document.removeEventListener("visibilitychange", syncVisibility);
  }
};

void bootstrap().catch((error) => {
  console.error("[app] 初始化失败", error);
  window.api.window.startupFailed(
    error instanceof Error ? error.stack || String(error) : String(error),
  );
});
