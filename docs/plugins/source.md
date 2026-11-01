# 音源解析

提供独立曲库的搜索与播放，或为已有歌曲补充播放地址、歌词、封面和评论。联网、存储和工具方法见[通用 API](/plugins/api)。

## 来源与路由

### 独立来源 {#independent}

来源声明 `musicSearch` 后，会显示在搜索页的「插件」入口中。插件启用并就绪时，用户可从下拉框选择来源进行单曲搜索；其余内容分类显示空状态。声明 `musicUrl` 可播放该来源的歌曲，歌词和封面也由所属插件提供。

宿主把搜索候选转换为 [Track](/types#track)，记录插件 ID、source key 和候选数据。播放队列保存这些信息，重启应用后仍向原插件获取播放地址。保持插件 ID、source key 和歌曲 ID 稳定，已入队的歌曲才能继续使用。

插件关闭或卸载后，队列中的歌曲会保留，但无法播放；重新启用或安装相同插件后可继续使用。

### 内置来源 {#builtin}

使用以下 source key 为内置来源提供解析。宿主按用户设置的插件优先级依次尝试播放地址，首个有效结果生效。

| 曲目平台标识 | source key |
| ------------ | ---------- |
| `netease`    | `wy`       |
| `qqmusic`    | `tx`       |
| `kugou`      | `kg`       |

## 快速开始

以下插件提供一个可搜索的曲库，搜索「示例」即可找到歌曲。保存为 `.js`，通过插件管理本地导入。

```js
/**
 * @name 示例曲库
 * @id you.example-library
 * @version 1.0.0
 * @apiLevel 5
 */
const catalog = [
  {
    id: "demo-1",
    name: "示例歌曲",
    singer: "示例歌手",
    album: "示例专辑",
    durationMs: 180000,
  },
];
splayer.register({
  sources: {
    example: {
      name: "示例曲库",
      actions: ["musicSearch", "musicUrl", "musicLyric", "musicPic"],
      qualities: ["hq"],
    },
  },
});
splayer.on("musicSearch", async ({ keyword, page = 1, limit = 20 }) => {
  const matches = catalog.filter((song) =>
    (song.name + " " + song.singer).toLowerCase().includes(keyword.toLowerCase()),
  );
  return { list: matches.slice((page - 1) * limit, page * limit), total: matches.length };
});
splayer.on("musicUrl", async ({ musicInfo }) => ({
  url: "https://media.example.com/" + encodeURIComponent(musicInfo.id) + ".mp3",
  quality: "hq",
}));
splayer.on("musicLyric", async () => ({ lyric: "[00:00.00]示例歌词" }));
splayer.on("musicPic", async ({ musicInfo }) => ({
  url: "https://media.example.com/" + encodeURIComponent(musicInfo.id) + ".jpg",
}));
```

示例中的媒体地址是占位地址，播放前需替换为自己的音频和封面地址。接入远端曲库时，将 `musicSearch` 改为调用服务并返回相同的候选结构，见[搜索歌曲](#musicsearch)。

## 音源注册 {#register}

在初始化时声明音源能力。

**调用：** `splayer.register(args)`

**API 版本：** 1；独立来源搜索与播放需要 5。

**权限：** 无

**参数：**

- `args.sources`（`Record<string, SourceCapability>`）：音源能力，键为插件内的 source key
- `args.sources[key].name`（`string`）：必填，音源展示名称
- `args.sources[key].actions`（`PluginAction[]`）：必填，从[支持动作](#actions)中选择
- `args.sources[key].qualities`（[Quality[]](#qualities)）：可选，支持的音质

**返回：** `void`。多个源共用同一动作处理器，根据请求的 `source` 分发。

### 支持动作 {#actions}

每个动作都需要通过 `splayer.on` 注册对应处理器。

| 动作                            | 用途     | 最低级别 |
| ------------------------------- | -------- | -------- |
| [`musicUrl`](#musicurl)         | 播放地址 | 1        |
| [`musicSearch`](#musicsearch)   | 搜索候选 | 1        |
| [`musicLyric`](#musiclyric)     | 获取歌词 | 1        |
| [`musicPic`](#musicpic)         | 获取封面 | 1        |
| [`musicComment`](#musiccomment) | 获取评论 | 3        |

### 音质级别 {#qualities}

| `Quality`  | 含义                                          |
| ---------- | --------------------------------------------- |
| `hi-res`   | 高解析度无损，采样率 ≥ 96 kHz 且位深 ≥ 24 bit |
| `lossless` | 无损                                          |
| `hq`       | 有损，码率 ≥ 320 kbps                         |
| `sq`       | 有损，码率 ≥ 192 kbps                         |
| `lq`       | 有损，码率 < 192 kbps                         |

## 音源解析 {#resolution}

通过 `splayer.on(action, handler)` 注册处理器，方法返回 `void`。`action` 为动作名，`handler: (req) => Promise<res>` 接收宿主请求并返回结果；重复注册同一动作会替换旧处理器。处理器本身不需要权限，内部调用的方法按各自的权限要求执行。

`musicUrl` 限时 20 秒，其余音源动作限时 15 秒。无法返回结果时抛出异常。内置来源解析可继续尝试其他插件；独立来源的播放请求只交给所属插件。

### 播放地址 {#musicurl}

提供歌曲播放地址。

**调用：** `splayer.on("musicUrl", handler)`

**API 版本：** 1

**权限：** 无

**参数：**

- `source`（`string`）：本次请求的 source key
- `quality`（`Quality`）：目标音质
- `musicInfo`（`object`）：独立来源收到原始搜索候选，另附 `songmid` 作为 `id` 的兼容别名；内置来源收到下列字段

- `musicInfo.songmid / id / songId`（`string`）：平台歌曲 ID，三个字段为别名
- `musicInfo.name`（`string`）：歌名
- `musicInfo.singer`（`string`）：艺术家名称，多人以 `/` 连接
- `musicInfo.source`（`string`）：source key
- `musicInfo.interval`（`string | null`）：`mm:ss` 时长，未知时为 `null`
- `musicInfo.img`（`string | null`）：封面 URL
- `musicInfo.hash`（`string`）：可选，使用哈希标识的来源提供此值
- `musicInfo.albumId / albumName`（`string`）：专辑 ID / 名称，未知时为空字符串
- `musicInfo.meta`（`object`）：专辑、封面等附加信息

**返回：** `Promise<{ url: string; quality?: Quality; expire?: number }>`。

| 结果字段  | 类型      | 说明                       |
| --------- | --------- | -------------------------- |
| `url`     | `string`  | 必填，非空播放地址         |
| `quality` | `Quality` | 可选，实际返回的音质       |
| `expire`  | `number`  | 可选，地址过期时间戳，毫秒 |

调用示例见[快速开始](#快速开始)。请求音质不可用时，可返回较低音质并注明 `quality`。

### 搜索歌曲 {#musicsearch}

返回独立来源的歌曲搜索结果，也可用于宿主匹配歌词、封面等元数据。

**调用：** `splayer.on("musicSearch", handler)`

**API 版本：** 1

**权限：** 无

**参数：**

- `source`（`string`）：source key
- `keyword`（`string`）：用户输入的搜索词；元数据匹配时通常由歌名和艺术家组成
- `page`（`number`）：可选，页码，从 1 开始
- `limit`（`number`）：可选，每页数量，独立来源搜索最多 50 条

**返回：** `Promise<{ list: Candidate[]; total?: number; hasMore?: boolean }>`。没有候选时返回 `{ list: [] }`。`total` 是匹配总数，`hasMore` 表示是否还有下一页，两者从 API 5 开始支持。

分页时优先返回 `hasMore`；总数已知时也可只返回 `total`。均省略时，宿主以本页数量是否达到 `limit` 判断下一页。

| `Candidate` 字段 | 类型     | 说明                                   |
| ---------------- | -------- | -------------------------------------- |
| `id`             | `string` | 必填，源内歌曲 ID                      |
| `name`           | `string` | 必填，歌名                             |
| `singer`         | `string` | 可选，艺术家                           |
| `album`          | `string` | 可选，专辑                             |
| `durationMs`     | `number` | 可选，时长（毫秒），用于歌曲展示和匹配 |
| `cover`          | `string` | 可选，封面 URL，API 5 新增             |
| 其他字段         | JSON 值  | 原样传给后续处理器                     |

独立来源候选会随队列保存。每条序列化后的数据最多 8 KiB，超出限制或字段不合法的条目会被忽略。仅保留歌曲标识和重新获取资源所需的轻量字段，歌词、图片内容和临时播放地址应在对应处理器中按需获取。

```js
splayer.on("musicSearch", async ({ keyword, page = 1, limit = 20 }) => {
  const query = new URLSearchParams({ keyword, page: String(page), limit: String(limit) });
  const { body } = await splayer.request("https://api.example.com/search?" + query, {
    responseType: "json",
  });
  return {
    list: body.songs.map((song) => ({
      id: String(song.id),
      name: song.title,
      singer: song.artist,
      album: song.album,
      durationMs: song.durationMs,
      cover: song.cover,
    })),
    hasMore: body.hasMore,
  };
});
```

## 元数据扩展 {#metadata-fallback}

### 匹配流程 {#matching}

独立来源的歌词和封面直接调用所属插件，`musicInfo` 为原始搜索候选，不再搜索匹配。候选已包含 `cover` 时直接使用；没有封面时才调用 `musicPic`。

为其他来源补充元数据时，注册 `musicSearch`，再按需要注册 `musicLyric`、`musicPic` 或 `musicComment`。宿主先搜索并按歌名、艺术家、专辑和时长选择候选，再把候选作为 `musicInfo` 传给后续处理器。同平台可直接使用平台歌曲 ID，跳过搜索。

歌词在内置来源或流媒体服务器未命中时尝试插件；封面只在曲目没有封面时补充。评论来源会显示在评论界面，需要同时声明 `musicSearch` 和 `musicComment`。

::: tip 候选时长
尽量填写 `durationMs`。双方都有时长且相差超过 20 秒的候选会被排除。
:::

```js
splayer.register({
  sources: {
    custom: { name: "Example", actions: ["musicSearch", "musicLyric", "musicPic", "musicComment"] },
  },
});
```

### 获取歌词 {#musiclyric}

返回歌曲的歌词。

**调用：** `splayer.on("musicLyric", handler)`

**API 版本：** 1

**权限：** 无

**参数：**

- `source`（`string`）：音源标识。
- `musicInfo`（`Candidate`）：独立来源的原始搜索候选，或元数据匹配选中的候选。

**返回：** `Promise<{ lyric: string; tlyric?: string; rlyric?: string; awlyric?: string }>`。

| 结果字段  | 类型     | 说明                           |
| --------- | -------- | ------------------------------ |
| `lyric`   | `string` | 必填，主歌词（LRC 或逐行文本） |
| `tlyric`  | `string` | 可选，翻译                     |
| `rlyric`  | `string` | 可选，罗马音                   |
| `awlyric` | `string` | 可选，逐字歌词，格式自动识别   |

有逐字歌词时优先使用 `awlyric`。元数据匹配未获得有效歌词时，宿主继续尝试其他候选；独立来源只使用所属插件。

```js
splayer.on("musicLyric", async ({ musicInfo }) => {
  const { body } = await splayer.request(
    "https://api.example.com/lyric?id=" + encodeURIComponent(musicInfo.id),
    { responseType: "json" },
  );
  return { lyric: body.lyric ?? "", tlyric: body.translation };
});
```

### 获取封面 {#musicpic}

返回歌曲的封面。

**调用：** `splayer.on("musicPic", handler)`

**API 版本：** 1

**权限：** 无

**参数：**

- `source`（`string`）：音源标识。
- `musicInfo`（`Candidate`）：独立来源的原始搜索候选，或元数据匹配选中的候选。

**返回：** `Promise<{ url: string }>`，封面图片的远端直链；空地址表示未命中。

```js
splayer.on("musicPic", async ({ musicInfo }) => {
  const { body } = await splayer.request(
    "https://api.example.com/cover?id=" + encodeURIComponent(musicInfo.id),
    { responseType: "json" },
  );
  return { url: body.url ?? "" };
});
```

### 获取评论 {#musiccomment}

分页返回候选曲目的评论。

**调用：** `splayer.on("musicComment", handler)`

**API 版本：** 3

**权限：** 无

**参数：**

- `source`（`string`）：source key
- `musicInfo`（`Candidate`）：匹配候选
- `type`（`"hot" | "new"`）：热门或最新评论
- `page`（`number`）：页码，从 1 开始
- `limit`（`number`）：每页数量

**返回：** `Promise<{ list: Comment[]; total: number; page: number; limit: number }>`，依次为当前页评论、总数、当前页码、每页数量。

| `Comment` 字段      | 类型        | 说明                     |
| ------------------- | ----------- | ------------------------ |
| `id`                | `string`    | 必填，评论 ID            |
| `userName`          | `string`    | 必填，用户名             |
| `text`              | `string`    | 必填，正文               |
| `userId` / `avatar` | `string`    | 可选，用户 ID / 头像 URL |
| `time`              | `number`    | 可选，毫秒时间戳         |
| `location`          | `string`    | 可选，地区               |
| `likedCount`        | `number`    | 可选，点赞数             |
| `images`            | `string[]`  | 可选，图片 URL           |
| `reply`             | `Comment[]` | 可选，回复摘要           |
| `replyTotal`        | `number`    | 可选，回复总数           |
| `hasMoreReply`      | `boolean`   | 可选，是否还有更多回复   |

```js
splayer.on("musicComment", async ({ musicInfo, type, page, limit }) => {
  const query = new URLSearchParams({
    id: musicInfo.id,
    type,
    page: String(page),
    limit: String(limit),
  });
  const { body } = await splayer.request("https://api.example.com/comments?" + query, {
    responseType: "json",
  });
  return {
    list: body.comments.map((comment) => ({
      id: String(comment.id),
      userName: comment.userName,
      text: comment.text,
    })),
    total: body.total,
    page,
    limit,
  };
});
```

## 更新与兼容

发布更新见[插件更新](/plugins/update)，已有 LX 脚本的接入见 [LX 兼容](/plugins/lx)。
