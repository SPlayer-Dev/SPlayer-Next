# 插件 API 级别

## 选择级别 {#choosing}

当前宿主 API 级别为 **5**。`@apiLevel` 声明插件所需的最低级别，`splayer.apiLevel` 返回运行中的宿主级别。高级别包含之前的能力；插件声明值高于宿主时，以 `PLUGIN_API_LEVEL_MISMATCH` 拒绝加载。

`@version` 和 `@changelog` 属于插件自身的版本信息，见[插件更新](/plugins/update)。

## 能力变更 {#history}

| 级别 | 新增能力                                                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 音源注册；`musicUrl`、`musicSearch`、`musicLyric`、`musicPic` 处理器；`request`、`storage`、`log`、`getSetting`、`utils`                                                                              |
| 2    | 播放控制；播放事件订阅；`play`、`pause`、`next`、`prev`、`seek`、`setVolume`、`getPosition`；设置项声明与 `onSettingChange`；歌曲菜单与 `menuClick`                                                   |
| 3    | `musicComment` 处理器，支持分页评论                                                                                                                                                                   |
| 4    | `music.searchOnline`、`music.searchLibrary`；`player.playTrack`、`addToQueue`、`stop`、`setPlayMode`、`getStatus`、`getNowPlaying`；`api.call`、`notify`；`library` 与 `api` 权限、用户管理权限       |
| 5    | `player.getQueue`；`player.getStatus` 返回 `currentIndex`；独立来源的搜索、播放和队列恢复；搜索候选支持 `cover`，结果支持 `total` / `hasMore`；`Track` 保存插件来源信息，歌词与封面直接向所属插件获取 |
