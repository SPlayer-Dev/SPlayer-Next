# 贡献指南

欢迎为 SPlayer-Next 贡献代码！本页介绍本地开发环境与基本约定。

## 环境要求

- **Node.js** >= 22
- **pnpm** >= 10
- **Rust 工具链**（构建原生模块所需，见 [原生模块](/native)）

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/SPlayer-Dev/SPlayer-Next.git
cd SPlayer-Next

# 安装依赖
pnpm install

# 启动开发（先以 debug 构建原生模块，再启动 Electron）
pnpm dev

# 启动开发时向程序传递参数
pnpm dev -- [参数]...
```

只做界面开发、想跳过 Rust 编译时，可设置 `SKIP_NATIVE_BUILD=true`。

## 构建

基础命令

```bash
pnpm build         # 完整构建：清理 → 原生模块 → 类型检查 → electron-vite
pnpm build:win     # 打包 Windows
pnpm build:mac     # 打包 macOS
pnpm build:linux   # 打包 Linux
```

高级命令

```bash
# 上面的构建命令默认会构建当前平台和架构的全部 target。可以通过下面的方法指定只打包某些 target
pnpm build:win nsis       # 打包 Windows 的 nsis 格式
pnpm build:mac dmg        # 打包 macOS 的 dmg 格式
pnpm build:linux tar.gz   # 打包 Linux 的 tar.gz 格式
# 全部 target 的列表详见 https://www.electron.build/docs/targets

# 仅构建未打包的程序目录，常用于本地测试（在 dist/xxx-unpacked 目录）
pnpm build:unpack
```

## 常用脚本

```bash
pnpm typecheck        # tsc + vue-tsc（node + web 双目标）
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm build:native     # 仅构建 Rust 原生模块（加 `--dev` 为 debug 构建）
```

## 项目结构

```
electron/main/      主进程：窗口、IPC、原生模块、服务
electron/preload/   预加载：通过 contextBridge 暴露 window.api
src/                渲染层：Vue 3 单页应用
windows/            桌面歌词 / 灵动岛 / 任务栏歌词等独立窗口
native/             Rust 原生模块（NAPI-RS）
shared/             跨进程共享的类型与默认配置
```

## 代码约定

- **注释**：一律中文，方法使用 JSDoc（`@param 名 - 说明` / `@returns`）；只在「为什么」不显然处写注释。
- **格式**：遵循 Prettier 配置（双引号、分号、100 列、尾随逗号）；提交前请运行 `pnpm format`。
- **类型检查**：提交前确保 `pnpm typecheck` 与 `pnpm lint` 通过。
- **原生类型**：从 `@splayer/*` 导入，切勿手写 `native/*/index.d.ts`。
- **提交信息**：使用单行中文标题，无特殊说明不附正文。

## 国际化

本项目使用 [vue-i18n](https://vue-i18n.intlify.dev/) 进行国际化

### Visual Studio Code 系列

推荐使用 [i18n Ally](https://marketplace.visualstudio.com/items?itemName=Lokalise.i18n-ally) 插件

1. 安装插件
2. 打开本项目，打开 `.vscode` 文件夹（若找不到，需要打开显示隐藏文件）
3. 编辑或新建 `settings.json` 文件，编辑或新增 `i18n-ally.localesPaths`，值为 `./src/i18n/locales/`，就像这样
   ```json
   {
     "i18n-ally.localesPaths": "./src/i18n/locales/"
   }
   ```

### JetBrains 系列

推荐使用 [Easy i18n](https://plugins.jetbrains.com/plugin/16316-easy-i18n) 插件

1. 安装插件
2. 打开本项目，在 **设置 → 工具 → Easy i18n** 中配置此插件
3. 在 **Modules Configuration → Add new module**，输入 SPlayer-Next（或任意名称），点击右侧的加号，新建模块
4. 在下方的配置中，找到 **Preset** 选择 **VUE_I18N**。在 **Resource Configuration** 的 **Path template** 中填写 `$PROJECT_DIR$/src/i18n/locales/{locale}.json`
5. (可选) 在上方的 **Common Configuration** 的 **Preview locale** 中填写 `zh-CN`

## 提交 Pull Request

1. 从 `dev` 分支切出特性分支进行开发；
2. 确保 `pnpm typecheck`、`pnpm lint` 通过，并已 `pnpm format`；
3. 向 `dev` 分支提交 PR，清晰描述改动动机与内容。

感谢你的贡献 💖
