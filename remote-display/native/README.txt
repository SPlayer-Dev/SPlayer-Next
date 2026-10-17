Surface Player 0.2.6 — 原生只读显示端

GTK 3 管理窗口，Pango 完成排版/字体回退，Cairo 绘制并缓存字形。
Python 只负责时间、可见行和网络事件；不加载 WebKit、Electron、Flutter 或 Avalonia。
帧更新只移动可见行、用矩形裁切字形高亮；静态封面区域不随歌词重绘。
歌词上下留白对应原版 FullPlayer 的 56/80 逻辑像素，并使用相同的边缘渐隐位置。
封面模糊背景使用 Pillow 在最长边 320px 的小图上计算，然后一次上传到 X11 图像缓存。
缓存仅包含当前背景和上下两条渐隐边缘；仅在封面或窗口尺寸变化时重建。
没有常驻背景动画，换歌会替换旧缓存；2160×1440 时这些图像约占 14 MiB。
默认数据源：http://192.168.2.38:14558，可通过 SURFACE_PLAYER_HOST 修改。

保留：逐词高亮、平滑滚动、翻译、逐行/逐词音译、Ruby 注音、和声、对唱对齐。
强调简化：不再逐字母缩放、上浮、发光；没有 AMLL 的渐变扫光和逐字动画。
Ruby 注音静态显示在所属词上方；罗马音固定显示在原文下方、翻译上方。
优先显示完整逐行罗马音，否则拼接逐词罗马音；Ruby 与罗马音可以同时显示。
跨多行的特别长 Ruby 注音词尚未做精细逐段排版。
歌词开始时用 300 ms 渐亮，结束后用 450 ms 渐暗，已点亮的字形在淡出期间保留。
前奏或两句间隔至少 7 秒时显示三个点，呼吸缩放、依次点亮，开唱前渐隐收起。
间奏检测合并重叠歌词/和声时间范围，不会在人声仍持续时误显示；暂停时随时钟冻结。没有播放控制、进度条、状态栏或全屏按钮。
英文字体显式指定 Times New Roman，其余优先 LXGW WenKai。
右侧歌词、注音和翻译相对 0.2.3 放大 7%。
频谱默认对齐原版：4px 柱宽、3px 间距、2px 圆角、80px 高度，并换算 Xft DPI。
柱数按可用宽度计算，频段取邻居均值；全部圆角路径合并填充，不增加图层。
主机每秒约 20 次推送 132 字节 SPF1 帧；Surface 每 16ms 更新显示。
沿用原版 50ms 插值与 0.4/0.88 的上升/回落参数，并按帧间隔修正。
不传音频、不在 Surface 做 FFT。暂停、隐藏、断线清空。
F11 切换全屏，Esc 退出全屏，Ctrl+Q 退出。断线全窗口覆盖淡红色，自动重连。
暂停/隐藏时停止帧循环，隐藏时取消高频网络订阅。

网络只使用已有 WebSocket subscribe-display / display-ping 和封面 GET。
0.2.4 扩展了主机订阅 API：subscribe-display 可带 spectrum:true，接收 SPF1 帧。
旧客户端不请求则不推送；隐藏/断开释放采样需求，与本机频谱消费者互不覆盖。
主机音频播放不受显示端测试、启动或退出影响。
仅保存当前歌词数据和排版高度；字形位图缓存最多 24 行、32 MiB
（单个异常巨大的歌词行可以独占一次缓存）。封面按显示尺寸缩小后保留。

安装：sudo apt install ./surface-player_0.2.6_all.deb
它升级原 surface-player 包；原有桌面入口和自启动命令继续有效。
回退：sudo apt install --allow-downgrades ./surface-player_0.1.1_all.deb
回退后重新启动 surface-player，即使用之前的 WebKit 显示端。

开发：python3 -m unittest discover -s remote-display/native -p 'test_model.py'
构建：bash remote-display/native/build-deb.sh /目标目录
原生诊断：~/.local/state/surface-player-native/status.json
WebKit 旧实现仍在 remote-display/src、vendor 和 desktop 中，可继续对照。

基准：SURFACE_NATIVE_FIXTURE=/path/snapshot.json SURFACE_NATIVE_START=160000
      SURFACE_NATIVE_COVER=/path/cover.jpg python3 remote-display/native/player.py
开始 2 秒热身，后 20 秒记录单调时钟实际回调间隔、绘制耗时和缓存大小。
需保持窗口可见；基准只重放给定歌词，不连接主机、不播放声音。
测试：DISPLAY=:0 python3 remote-display/native/test_integration.py /path/snapshot.json
集成测试使用本机 17658 端口的模拟 WebSocket 服务；检查暂停、恢复、跳转、
隐藏/显示、断线重连、尺寸变化、切歌、注音和长歌词缓存。

本代码属于 SPlayer-Next，使用仓库 AGPL-3.0 许可证。

三个点的时间编排和贝塞尔曲线参考 AMLL Core 0.6.0 的 interlude-dots.ts，
https://github.com/amll-dev/applemusic-like-lyrics ，许可证见 AMLL-LICENSE。
离线绘图检查：python3 remote-display/native/test_effects.py /输出目录
