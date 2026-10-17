AMLL 0.6.0 — Surface 显示端专用分支

上游：@applemusic-like-lyrics/core 0.6.0
https://github.com/amll-dev/applemusic-like-lyrics/tree/main/packages/core
许可证：AGPL-3.0-only，完整文本见 LICENSE。
upstream.mjs 为原始 npm 发布产物，SHA-256：
fd3dd4a8ba727b7cbb860b0e0879683f18c74cf0116297d3b8239fcac6e6af5c

修改由 optimize.mjs 重现，输入文件哈希不符会拒绝构建。
正常构建直接运行仓库 pnpm build:display；已包含通过实测选择的参数。
本入口只供 Surface 使用；主机原 SPlayer-Next 的 AMLL 包和 API 实现不受影响。

保留的修改
- 静止弹簧停止数值求解及闭包重建，延迟参数队列执行一次后清空。
- 复用已维护的行组 WeakMap，去掉逐帧 indexOf 导致的二次复杂度。
- 字体/宽度未变时复用平衡换行结果；词尺寸未变时不重建遮罩。
- 渐变遮罩沿用上游关键帧和注音时间轴，本地时钟取样，只写入发生变化的位置。
- 强调改为一个词整体缩放/上浮，取消逐字母分别建立动画；逐词点亮保持不变。
- 关闭动态文字辉光；保留正常滚动、弹簧、逐词上浮、强调缩放、注音、对唱和和声。
- 离屏 DOM/动画只保留最近 12 组；其余释放，回到视口时重建。
- 销毁播放器时断开 ResizeObserver。
- 只生成 DOM 歌词入口，不带入背景、调色板和 Pixi 模块。

实验开关
--2d / --solid-masks 是回归实验，默认构建不启用：在 Surface WebKit 上反而变慢。
省略 --word-emphasis 可以恢复逐字母强调，省略 --no-glow 可以恢复动态辉光。
这些是构建时对照参数，不在显示界面增加设置或控件。

验证
node --test remote-display/tests/amll.test.mjs
基准和生命周期测试见 ../../bench；主机音乐不参与这些重放测试。
