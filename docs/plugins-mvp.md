# 插件系统 MVP 进度与延续文档

> 用于跨设备/跨会话接续本次工作。**本文档就是接续上下文的入口**——另一台机器拉下来后，打开它 + `plans/`（如果同步了 home 目录的 plan 文件）+ `CLAUDE.md` 就能接上。

## 背景

- 参考 `lx-music-desktop` 的 `user_api` 插件机制，为 SPlayer-Next 加入可扩展插件系统
- 覆盖三类能力：**音源搜索 + URL 解析**、**歌词来源**、**元数据/封面来源**
- 隔离方案：`utilityProcess.fork()` + 子进程内 `vm.createContext`（进程级 + VM 级双层隔离）
- 兼容 `lx-music-desktop` 的 `user_api` 脚本（`window.lx` 垫片 + `gz_` 前缀解码）
- HostApi 一次设计到位，MVP 仅端到端打通 `search` / `musicUrl` 两个动作

## 已完成（MVP）

### 主进程插件内核

| 文件                                      | 职责                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `shared/types/plugin.ts`                  | 跨进程类型契约：`PluginManifest` / `PluginStatus` / `HostApi` / `SandboxIn/Out` / `PluginsApi` 等            |
| `shared/defaults/plugin-api.ts`           | `HOST_API_LEVEL` 常量、action 超时、错误码枚举、默认配置                                                     |
| `electron/main/plugins/sandbox.ts`        | `utilityProcess.fork` 控制器：启停、心跳、崩溃重启、消息编解码                                               |
| `electron/main/plugins/sandbox.worker.ts` | 子进程入口：`vm.createContext` → 注入 `splayer` + 可选 `lx` 垫片 → `vm.runInContext`                         |
| `electron/main/plugins/host.ts`           | `HostApi` 主进程侧 dispatch：network / storage / log                                                         |
| `electron/main/plugins/net.ts`            | 网络代理：`net.fetch` + URL 白名单（仅 http/https）+ 超时                                                    |
| `electron/main/plugins/storage.ts`        | 每插件 KV 落盘 `{userData}/plugins/data/{id}.json`，原子写                                                   |
| `electron/main/plugins/loader.ts`         | 头部 JSDoc 解析 + `gz_` 解压 + `id = name + sha1(source).slice(0,8)`                                         |
| `electron/main/plugins/registry.ts`       | `Map<id, PluginRuntime>` + 扫描/启停/重启/生命周期状态机                                                     |
| `electron/main/plugins/router.ts`         | action 调度：`search` / `musicUrl`（超时、取消、fallback）                                                   |
| `electron/main/plugins/lx-shim.ts`        | `window.lx` 适配：`request` / `on('request')` / `send('inited')` / `utils`                                   |
| `electron/main/ipc/plugin.ts`             | IPC 注册：`plugin:list/install/pickAndInstall/uninstall/setEnabled/search/resolveUrl` + `plugin:status` 广播 |

### 渲染端插件管理 UI

| 文件                                               | 职责                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/stores/plugins.ts`                            | Pinia store：`list` / `load` / `pickAndInstall` / `uninstall` / `setEnabled` + 订阅 `plugin:status` |
| `src/components/settings/custom/PluginManager.vue` | 管理面板：顶部导入条 / 空态 / 插件卡片列表 / 卸载确认                                               |
| `src/components/settings/SettingsItem.vue`         | 增加 `fullWidth` 分支渲染（custom 组件独占整行时跳过 label/卡片外壳）                               |
| `src/types/settings-schema.ts`                     | `SettingItem.fullWidth?: boolean`                                                                   |
| `src/settings/schema.ts`                           | 新增 `plugins` category（puzzle 图标）+ 挂 `PluginManager`（fullWidth）                             |

### 改动的现有文件

- `electron/main/ipc/index.ts` — 注册 `registerPluginIpc()`
- `electron/main/core/index.ts` — app ready 调 `pluginRegistry.init()`；退出调 `shutdown()`
- `electron/preload/index.ts` / `index.d.ts` — 新增 `api.plugins.*`（含 `pickAndInstall`）
- `shared/defaults/settings.ts` — 新增 `plugins: defaultPluginsConfig`
- `shared/types/settings.ts` — `SystemConfig` 加 `plugins: PluginsConfig`
- `shared/types/player.ts` — `TrackSource` 扩 `"plugin"`；`Track` / `OnlineMatch` 增 `pluginId` / `pluginSource`
- `shared/types/lyrics.ts` — `LyricSource` union 加 `{ type: "plugin"; pluginId; format }`
- `electron.vite.config.ts` — `main.build.rollupOptions.input` 增补 `sandbox.worker` 独立 entry
- `src/i18n/locales/{zh-CN,en-US}.json` — `settings.group.plugins` / `settings.section.pluginsList` / `settings.plugins.*` / `settings.pluginManager.*`

## 验证方法（DevTools 控制台）

1. `pnpm dev` 起开发环境
2. 打开"设置 → 插件管理" → 点击"导入插件"选择 `.js` 脚本
3. 或直接放脚本到 `{userData}/plugins/scripts/{name}.js` + 重启
4. DevTools 里：
   ```js
   await window.api.plugins.list();
   await window.api.plugins.search({ keyword: "test" });
   await window.api.plugins.resolveUrl({
     pluginId: "xxx",
     source: "kw",
     musicInfo: { songmid: "abc" },
     quality: "320k",
   });
   ```
5. 异常场景：
   - 强 kill utilityProcess 子进程 → 3 次指数退避自动重启（2s/8s/30s），累计 3 次失败后 `disabled`
   - 写 `while(true){}` 脚本 → 心跳 10s × 3 miss 后自杀重启
   - 导入 `gz_` 前缀的 lx 脚本 → loader 自动解压并走 `lx-shim`

## 二期待办（下次会话接续这里）

### 优先 1：让插件真正接入播放链路

- `src/services/sourceResolver.ts` 渲染端门面：合并多插件结果、按优先级 fallback、去重
- `src/services/audioLoader.ts` 判断 `track.source === "plugin"` → 先 `resolveUrl` 再交给 player
- `src/pages/OnlineSearch.vue` 搜索页（或融入 Library）：输入关键词 → 结果列表 → 点击播放

### 优先 2：歌词/元数据接入

- `src/services/lyricLoader.ts` 新增 `source.type === "plugin"` 分支 → `api.plugins.fetchLyric`
- 主进程 `ipc/plugin.ts` 暴露 `plugin:fetchLyric` / `plugin:fetchMeta` handler
- `router.ts` 里已有骨架，补 `lyric` / `meta` action 分派

### 优先 3：UI 增强

- 每插件独立设置抽屉：读插件上报的 `settingsSchema`（HostApi 已预留）
- 查看插件日志按钮（现已写文件 `{userData}/plugins/logs/{id}.log`，补一个查看入口）
- 插件优先级拖拽排序（写 `settings.plugins.priority.{action}[]`）

### 待清理的技术细节

- `registry.ts` 的 `pickForAction` 方法当前未被使用（router 直接按 listInfo 拿顺序），二期启用优先级后可统一用它
- `router.ts` `searchAcrossPlugins` 对 `pluginRegistry.listInfo` 的访问写法不够优雅，二期重构
- `sandbox.worker.ts` 几处 `any` 是因为 `process.parentPort` / `splayer.utils` 需要；Electron 类型出正式 typings 时可去掉

## 三期（未来可选）

- 插件签名（Ed25519 公钥 + 开发者白名单）
- 官方插件市场（GitHub Releases 拉取 + 版本检测 + 自动更新）
- 热重载（`chokidar` 监视 `scripts/{id}.js`）
- UI 扩展位（让插件注册自己的设置面板/菜单项）

## 架构简图

```
Renderer (Vue)
  PluginManager.vue ──▶ stores/plugins ──▶ api.plugins.* (preload)
                                              │
                                              ▼
                                      ipc/plugin.ts (main)
                                              │
                                    ┌─────────┼─────────┐
                                    ▼         ▼         ▼
                                registry   router   host
                                    │         │         │
                                    ▼         ▼         ▼
                                 sandbox (utilityProcess N 个)
                                    │ vm.createContext
                                    ▼
                                  splayer / lx 垫片
                                    │
                                    ▼
                                 插件脚本
```

## 关键约定

- **脚本头部 JSDoc**：`@name` `@version` 必填；`@description` `@author` `@homepage` `@platform` `@apiLevel` 可选
- **lx 识别**：`gz_` 前缀 → 自动按 lx 处理；或显式 `@platform lx`
- **id 生成**：`slugify(name) + sha1(source).slice(0,8)`
- **HostApi 动作响应形状**：见 `shared/types/plugin.ts` 的 `ActionIO` 映射
- **超时**：search 10s / musicUrl 20s / lyric·pic·meta 15s
- **并发**：每插件 4、全局 16（常量定义在 `shared/defaults/plugin-api.ts`）

## 验证命令

```bash
pnpm typecheck  # 0 error
pnpm lint       # 0 error / 0 warning
npx electron-vite build  # 产出 out/main/{index,sandbox.worker}.js
```

## 接续指引

**新会话打开后**：

1. 读这份 `docs/plugins-mvp.md`
2. 读 `CLAUDE.md`（项目约定）
3. `git log --oneline` 看最近提交确认已到位
4. 按"二期待办"优先 1 开始：实现 `sourceResolver` + 接 `audioLoader` + 做 `OnlineSearch.vue` 页面
