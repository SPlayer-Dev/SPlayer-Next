当前默认版本：Surface Player 0.2.1，原生 GTK/Pango/Cairo 显示端。
安装、运行、基准和视觉取舍见 native/README.txt；源码位于 native/。
它继续使用现有主机 API，不加载 WebKit，也不要求构建浏览器页面。
以下保留此前 WebKit/AMLL 版本的文档，作为回退和性能对照参考。

Surface Player — AMLL 性能优化版（桌面壳 0.1.1）

用途
Surface 上只保留播放界面。音乐解码、音频输出、曲库、歌词查找/解析在主机
SPlayer-Next 运行。网络只传播放数据、完整歌词、封面，不传视频或音频。
歌词由 Surface 本地 AMLL 引擎绘制，因此仍需要一定的 CPU/GPU，不能保证所有
TTML 歌曲都达到 60 FPS。布局参考原版 FullPlayer，歌词使用本地优化的 AMLL 0.6 分支。
强调采用整词缩放/上浮，取消逐字母波浪和动态辉光；保留逐词高亮、注音、和声、对唱。
完整修改与可重建脚本见 vendor/amll-core/README.txt。

主机
在仓库根目录运行 pnpm build:display，然后启动修改后的 SPlayer-Next。
pnpm dev 和 pnpm build 已包含显示端构建；打包版将显示端复制进 extraResources。
开启设置中的外部 API、WebSocket、允许局域网访问，端口 14558。
已部署主机地址为 192.168.2.38。仅允许 Surface 192.168.2.155 访问该端口。
显示入口：http://192.168.2.38:14558/display/
此 API 沿用原版无鉴权机制；不要将端口转发到公网。

Surface 安装
sudo apt install ./surface-player_0.1.1_all.deb
运行 surface-player。依赖 GTK 3、Python GI、WebKit2GTK 4.1，由 apt 解决。
登录自启：
mkdir -p ~/.config/autostart
cp /usr/share/applications/surface-player.desktop ~/.config/autostart/
改主机地址时可使用环境变量 SURFACE_PLAYER_URL（完整 /display/ URL）。
F11 切换全屏；Esc 退出全屏；Ctrl+Q 退出。
本界面只展示，不发送任何播放控制；点击歌词、空格键均不操控播放。
歌词使用全部窗口高度；英文使用 Times New Roman，中文使用霞鹜文楷。
没有 Playback、顶部状态文字和全屏按钮；失联时显示全屏淡红色遮罩。
主机不可达时会自动重连；同一用户重复启动只激活现有窗口。

开发与验证
pnpm exec tsc -p remote-display/tsconfig.json
pnpm exec tsx --test remote-display/src/clock.test.ts
pnpm typecheck:node
pnpm build:display
bash remote-display/desktop/build-deb.sh /目标目录
Debian 包构建需要 dpkg-deb，可在 Surface 上构建，Architecture 为 all。
显示端状态每 5 秒写入 ~/.local/state/surface-player/status.json。
状态中的 fps 是 requestAnimationFrame 更新率，不是屏幕实际呈现帧的保证。

接口
GET /api/display/snapshot：当前曲目、完整解析歌词、歌词偏移、播放状态、速度、
毫秒位置/时长、音量及发送时间。
GET /api/display/cover?trackId=当前歌曲ID：主机代理当前大封面。
增加 size=thumbnail 参数获取用于静态背景的小封面。
WS /ws：{op:"subscribe-display",visible:true} 订阅 display-snapshot、
display-position（播放时约 5Hz）、display-offset。
visible:false / 关闭连接会释放订阅。重新可见时订阅并取得完整快照。
{op:"display-ping",clientTime:performance.now()} 校准两台机器时钟偏差。
主机原有控制接口仍保留供其他客户端使用，本显示端不调用。
位置在本地插值，不用网络推送频率限制动画帧率。

本次迁移
Surface 原 SPlayer-Next 已卸载。其完整用户数据移至：
~/.local/state/codex-surface/splayer-removed-20261011/SPlayer-Next
新应用不迁移或重新播放这些数据，主机继续使用自己的曲库和设置。
主机源码基于提交 c5188391d0613efa1461f07be28f44a20bfe5f17。
上游升级/重新安装原版可能覆盖本次主机接口修改，应保留补丁并重新合入。

许可
本实现随 SPlayer-Next 使用 AGPL-3.0，详见仓库 LICENSE。
AMLL 使用其原始许可证，见 node_modules/@applemusic-like-lyrics/core/LICENSE。
