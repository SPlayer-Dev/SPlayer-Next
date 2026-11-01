# 插件总览与架构

插件是通过全局对象 `splayer` 扩展 SPlayer-Next 的 JavaScript 脚本。

| 文档                                | 内容                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| [插件开发](/plugins/development)    | 第一个插件、开发流程和 Agent 辅助资料                    |
| [通用 API](/plugins/api)            | 网络请求、歌曲搜索、平台接口、通知、存储、设置和工具方法 |
| [音源解析](/plugins/source)         | 独立曲库搜索、播放地址、歌词、封面和评论                 |
| [播放控制](/plugins/control)        | 播放事件、播放控制、队列和歌曲菜单                       |
| [插件 API 级别](/plugins/changelog) | 各 API 级别引入的能力                                    |
| [插件更新](/plugins/update)         | 版本信息与更新发布                                       |
| [LX 兼容](/plugins/lx)              | LX 脚本导入、兼容接口和更新提示                          |

安装和权限管理见[插件使用指南](/plugins-usage)。

## 技术架构

### 进程模型

所有启用的插件共享一个独立的 Electron utility process，每个插件在其中拥有自己的 `node:vm` 上下文。应用主进程负责插件管理、权限校验、网络请求、存储和播放控制；插件通过 `splayer` 发起调用，消息按插件 ID 路由。

```text
应用界面
    ↕ IPC
应用主进程
    ├─ 插件注册表、权限与生命周期
    ├─ 播放控制、平台接口、网络与存储
    ↕ 按插件 ID 路由消息
插件宿主进程
    ├─ 插件 A：vm 上下文、处理器、定时器
    └─ 插件 B：vm 上下文、处理器、定时器
```

插件不占用应用界面的执行线程，但共享宿主的事件循环。一个插件的阻塞代码会影响其他插件；宿主进程退出时，所有已启用插件都需要重新加载。`splayer.storage` 按插件 ID 保存数据，`node:vm` 不构成恶意代码的安全隔离。

### 交互流程

音源请求由宿主发起：搜索页调用所选来源的搜索处理器，将结果转换为曲目；播放器再调用地址、歌词和封面处理器。独立来源通过曲目中保存的插件 ID 和 source key 路由，内置来源按插件优先级选择。处理器中的网络与存储调用由主进程执行。

```text
搜索页 → 来源的搜索处理器 → Track → 播放队列
播放器 → 曲目所属来源的处理器 → 播放地址 / 元数据
```

播放事件由应用推送：曲目、歌词或播放状态变化后，宿主只向订阅了相应事件的插件发送载荷。插件调用播放控制方法时，请求经主进程转交播放器。

```text
播放状态变化 → 已订阅的插件回调
插件调用播放方法 → 主进程校验 → 播放器执行 → 状态事件
```

### 生命周期

```text
安装 → 解析脚本头部 → 启用 → 创建执行上下文 → 执行脚本与注册能力 → 就绪
禁用 → 清理回调与定时器 → 释放该插件上下文
卸载 → 停止插件 → 删除脚本与私有数据
宿主退出 → 重启宿主 → 重新加载已启用插件
```

| 状态       | 含义                                     |
| ---------- | ---------------------------------------- |
| `unloaded` | 已安装，尚未加载                         |
| `loading`  | 正在启动或等待重载                       |
| `ready`    | 已就绪，可以响应请求                     |
| `error`    | 加载失败或宿主重启次数超限，附带错误信息 |
| `disabled` | 用户已禁用                               |

禁用单个插件不会重启宿主或其他插件。宿主崩溃或失去响应时，应用依次等待 2、8、30 秒尝试重启；超过重试次数后标记为 `error`。

### 运行环境

宿主注入 `splayer`、`Buffer`、`URL`、`URLSearchParams`、`TextEncoder`、`TextDecoder`、`btoa`、`atob`、Promise、微任务、定时器和 `console`。脚本环境不提供 Node 模块导入、`require`、DOM 或 Electron API。

| 限制                    | 数值                |
| ----------------------- | ------------------- |
| 宿主启动 / 插件加载超时 | 各 10 秒            |
| 顶层同步代码执行时限    | 10 秒               |
| 网络请求默认 / 最大超时 | 15 / 60 秒          |
| 在线导入脚本大小        | 最大 9,000,000 字节 |

在初始化阶段注册能力和处理器，将网络请求等耗时工作放入异步逻辑。

## 脚本声明

在文件开头用 JSDoc 注释声明插件信息：

```js
/**
 * @name 示例插件
 * @id you.example
 * @version 1.0.0
 * @description 记录当前播放的歌曲
 * @author you
 * @apiLevel 2
 */
splayer.register({ events: ["trackChange"] });
splayer.player.on("trackChange", ({ track }) => {
  if (track) splayer.log.info(track.title);
});
```

保存为 `example.js`，在 **设置 → 插件管理 → 本地导入** 中安装。

| 字段           | 说明                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- |
| `@name`        | 展示名称；省略时根据脚本生成                                                             |
| `@id`          | 稳定的插件标识，如 `you.example`；省略时根据名称推导                                     |
| `@version`     | 插件版本，默认 `0.0.0`                                                                   |
| `@description` | 简介                                                                                     |
| `@author`      | 作者                                                                                     |
| `@homepage`    | 主页 URL                                                                                 |
| `@apiLevel`    | 插件所需的最低宿主 API 级别，默认 `1`；具体能力要求见[插件 API 级别](/plugins/changelog) |
| `@grant`       | 申请的权限，以空格或逗号分隔                                                             |
| `@updateUrl`   | 最新脚本地址，见[插件更新](/plugins/update)                                              |
| `@changelog`   | 插件版本更新说明                                                                         |

建议明确填写 `@name`、`@id` 和 `@version`。发布新版时保持 `@id` 不变，重新导入相同 ID 的脚本会替换已安装版本。

## 权限

在头部声明所需权限，例如 `@grant network control`。声明的权限默认开启，用户可在插件详情中关闭。`network` 为默认权限。

| 权限      | 对应方法                                           |
| --------- | -------------------------------------------------- |
| `network` | `request`、`music.searchOnline`                    |
| `control` | 播放控制与状态查询；`player.on` 事件监听不需要权限 |
| `ui`      | 歌曲菜单、`notify`                                 |
| `library` | `music.searchLibrary`                              |
| `api`     | `api.call`，使用应用当前的账号登录状态             |

## 数据存储

```text
{userData}/app-data/plugins/
├─ scripts/        已安装脚本
├─ data/           按插件 ID 保存的私有数据
└─ manifest.json   已安装插件的元数据索引
```

权限选择、启用状态、设置值和优先级保存在应用配置中。迁移便携版时，复制完整的 `app-data` 目录可保留插件和数据。

## 调试

使用 `splayer.log` 或 `console` 输出日志，在 `{userData}/app-data/logs/` 查看。修改脚本后重新导入即可重新加载。

返回 Promise 的方法在权限不足或参数错误时 reject。平台业务响应的处理方式见 [api.call](/plugins/api#platform-api)。返回 `void` 的旧播放控制方法不向调用者报告失败。

| 错误码                      | 含义                        |
| --------------------------- | --------------------------- |
| `PLUGIN_PERMISSION_DENIED`  | 所需权限不可用              |
| `PLUGIN_API_LEVEL_MISMATCH` | 插件要求的 API 级别高于宿主 |
| `PLUGIN_INVALID_MANIFEST`   | 脚本头部不合法              |
| `PLUGIN_SCRIPT_ERROR`       | 脚本语法或执行错误          |
| `PLUGIN_LOAD_TIMEOUT`       | 插件初始化超时              |
| `PLUGIN_ACTION_UNSUPPORTED` | 未注册对应动作处理器        |
| `PLUGIN_HANDLER_ERROR`      | 动作处理器抛出异常          |
| `PLUGIN_REQUEST_TIMEOUT`    | 请求超时                    |
| `PLUGIN_CANCELLED`          | 请求被取消                  |
| `PLUGIN_NETWORK_ERROR`      | 网络请求失败                |
| `PLUGIN_URL_NOT_ALLOWED`    | URL 协议不支持              |
| `PLUGIN_NOT_READY`          | 插件未就绪                  |
| `PLUGIN_NOT_FOUND`          | 插件未安装                  |
| `PLUGIN_DISABLED`           | 插件已禁用                  |
| `PLUGIN_WORKER_CRASHED`     | 插件宿主进程退出            |
| `PLUGIN_UNKNOWN`            | 其他错误，查看错误信息      |

## 发布插件

在 [SPlayer-Dev/plugins](https://github.com/SPlayer-Dev/plugins) 使用「新建插件」或「更新插件」Issue 模板提交脚本，通过校验和维护者审核后进入插件市场。
