Surface WebKit 基准

fixture.json 为本机私有逐词歌词样本，已 gitignore，不打进源码交付包。
可从当前主机的 /api/display/snapshot 取 lyric/source 字段保存为 fixture.json。
QRC 样本测试前必须选定一次，之后所有分支都使用这个冻结文件。
TTML 与 long 为 main.ts 生成的合成逐词、和声、对唱和注音压力数据。

pnpm exec vite build --config remote-display/bench/vite.config.ts
Surface 页面：/display/benchmark/index.html?variant=original&case=qrc
variant=original 使用原始 npm 包，其余值使用 vendor 当前生成的分支。
case 可选 qrc / ttml / long / lrc / lifecycle。
real / realblank / reallayer 使用 real-fixture.ttml（原始 TTML 文件）和 cover.jpg。
这些真实样本已 gitignore，不在交付包中。构建基准前请自行准备；正式构建不需要它们。
真实 TTML 重放 160–182 秒；realblank 不放封面，reallayer 单独合成封面区域。
realcompact / ttmlcompact 为缩小词遮罩纵向留白的回归实验，不用于正式界面。

固定重放 30–52 秒，前两秒热身，后 20 秒统计。
测试不连接 WebSocket、不播放音频、不控制主机。
结果写入 window.surfacePlayerDiagnostics，桌面壳每 5 秒保存为 status.json。
需保持屏幕点亮、窗口可见；锁屏/未完成/有 error 的样本一律作废。
RAF 数字不等于逐个像素实际呈现的硬件帧率。

正常 pnpm build:display 会清除临时 benchmark 构建，生产界面不包含该页面。
