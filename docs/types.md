# 类型参考

插件在事件回调和处理器入参里收到的数据类型，完整字段集中列在这里。带 `?` 的字段为可选。

## 曲目

### Track

一首歌曲的完整信息。控制插件的 [`trackChange`](/plugins/control#监听播放事件) 事件载荷与菜单点击（[`menuClick`](/plugins/control#菜单扩展)）入参的 `track` 均为此对象。

| 字段            | 类型                               | 说明                                  |
| --------------- | ---------------------------------- | ------------------------------------- |
| `id`            | `string`                           | 曲目 ID                               |
| `extId`         | `string?`                          | 二级 ID                               |
| `source`        | [`TrackSource`](#tracksource)      | 歌曲来源                              |
| `path`          | `string?`                          | 本地文件路径（仅本地歌曲）            |
| `cuePath`       | `string?`                          | CUE 文件路径                          |
| `cueAudioPath`  | `string?`                          | CUE 指向的音频文件路径                |
| `cueStartMs`    | `number?`                          | CUE 分轨起始时间（毫秒）              |
| `cueEndMs`      | `number?`                          | CUE 分轨结束时间（毫秒）              |
| `serverId`      | `string?`                          | 流媒体服务器实例 ID（仅 `streaming`） |
| `originalId`    | `string?`                          | 流媒体服务器原生 ID（仅 `streaming`） |
| `title`         | `string`                           | 标题                                  |
| `comment`       | `string?`                          | 注释 / 副标题                         |
| `artists`       | [`Artist[]`](#artist)              | 歌手                                  |
| `album`         | [`Album`](#album)`?`               | 专辑                                  |
| `track`         | `number?`                          | 曲目编号                              |
| `duration`      | `number`                           | 时长（毫秒）                          |
| `cover`         | `string?`                          | 封面地址                              |
| `coverOriginal` | `string?`                          | 原始封面地址                          |
| `fileSize`      | `number?`                          | 文件大小（字节）                      |
| `mtime`         | `number?`                          | 修改时间（Unix 毫秒）                 |
| `ctime`         | `number?`                          | 创建时间（Unix 毫秒）                 |
| `quality`       | [`AudioQuality`](#audioquality)`?` | 音质信息                              |
| `fee`           | [`TrackFee`](#trackfee)`?`         | 付费标记                              |
| `cloud`         | `boolean?`                         | 是否云盘歌曲                          |

### TrackSource

歌曲来源：`"local"`（本地文件）、`"streaming"`（流媒体服务器），或内置在线平台 `"netease"`、`"qqmusic"`、`"kugou"`。插件自己的 source key 不会写入 `TrackSource`。

### TrackFee

付费标记遵循网易云 `fee` 规范：`0` 免费、`1` VIP、`4` 需购买（数字专辑等）、`8` 受限音质。

### Artist

| 字段         | 类型      | 说明       |
| ------------ | --------- | ---------- |
| `id`         | `string?` | 歌手 ID    |
| `name`       | `string`  | 歌手名     |
| `avatar`     | `string?` | 头像地址   |
| `albumCount` | `number?` | 名下专辑数 |

### Album

| 字段         | 类型      | 说明               |
| ------------ | --------- | ------------------ |
| `id`         | `string?` | 专辑 ID            |
| `name`       | `string`  | 专辑名             |
| `cover`      | `string?` | 封面地址           |
| `artist`     | `string?` | 专辑歌手（字符串） |
| `trackCount` | `number?` | 曲目数             |
| `year`       | `number?` | 发行年份           |

### AudioQuality

| 字段            | 类型     | 说明          |
| --------------- | -------- | ------------- |
| `sampleRate`    | `number` | 采样率（Hz）  |
| `channels`      | `number` | 声道数        |
| `bitsPerSample` | `number` | 位深          |
| `bitRate`       | `number` | 比特率（bps） |
| `codec`         | `string` | 编码格式      |

## 歌词

### LyricLine

一行歌词。控制插件的 [`lyricChange`](/plugins/control#监听播放事件) 事件载荷 `lines` 即 `LyricLine[]`。

| 字段              | 类型                                     | 说明                                           |
| ----------------- | ---------------------------------------- | ---------------------------------------------- |
| `words`           | [`LyricWord[]`](#lyricword)              | 该行逐字内容；逐行（LRC 类）格式时只有一个元素 |
| `translatedLyric` | `string`                                 | 翻译，无则为空串                               |
| `romanLyric`      | `string`                                 | 音译 / 罗马音，无则为空串                      |
| `startTime`       | `number`                                 | 行起始时间（毫秒）                             |
| `endTime`         | `number`                                 | 行结束时间（毫秒）                             |
| `isBG`            | `boolean`                                | 是否为背景和声行                               |
| `isDuet`          | `boolean`                                | 是否为对唱行（通常右对齐显示）                 |
| `language`        | `"ja" \| "ko" \| "zh-CN" \| "und-Latn"?` | 主歌词语言，用于字形选择与 HTML `lang`         |

整行纯文本：`line.words.map((word) => word.word).join("")`。逐行歌词的逐字时间通常与行时间一致，不必关心 `words` 内部时间。

### LyricWord

逐字内容，继承 [`LyricSpan`](#lyricspan) 的全部字段，并附加：

| 字段        | 类型                           | 说明                               |
| ----------- | ------------------------------ | ---------------------------------- |
| `romanWord` | `string?`                      | 该字音译                           |
| `obscene`   | `boolean?`                     | 是否敏感词                         |
| `ruby`      | [`LyricSpan[]`](#lyricspan)`?` | 注音（如日语假名标注），通常用不到 |

### LyricSpan

| 字段        | 类型     | 说明             |
| ----------- | -------- | ---------------- |
| `startTime` | `number` | 起始时间（毫秒） |
| `endTime`   | `number` | 结束时间（毫秒） |
| `word`      | `string` | 内容文本         |
