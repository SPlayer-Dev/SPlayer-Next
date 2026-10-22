import { appVersion } from "@main/utils/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { playerControl } from "@main/services/playerControl";
import * as nowPlaying from "@main/services/nowPlaying";
import { getAlbumList, getArtistList, getRandomTracks, getTrackCount } from "@main/database";
import { createMcpEndpoint as createHttpEndpoint, type McpEndpoint } from "./endpoint";
import {
  searchOnline,
  searchLibrary,
  trackSchema,
  queueQuerySchema,
  onlineSearchSchema,
} from "@main/services/music";

const jsonContent = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

/**
 * 创建并注册 SPlayer MCP 工具与资源
 * @returns 供 HTTP 会话使用的 MCP 服务
 */
const createServer = (): McpServer => {
  const server = new McpServer({
    name: "splayer-next",
    version: appVersion,
  });

  server.registerTool(
    "get_playback_status",
    {
      title: "获取播放状态",
      description:
        "获取 SPlayer 当前播放状态、队列索引、进度、时长和音量。currentIndex 从 0 开始，无当前队列项时为 -1。时间单位为毫秒",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    () => jsonContent(playerControl.getStatus()),
  );

  server.registerTool(
    "get_now_playing",
    {
      title: "获取当前歌曲",
      description: "获取当前歌曲和播放位置的轻量快照，不包含完整歌词正文",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    () => jsonContent(nowPlaying.lightSnapshot()),
  );

  server.registerTool(
    "get_queue",
    {
      title: "读取播放队列",
      description:
        "按当前播放顺序读取队列，返回 Track 数组、总数、当前曲目在整个队列中的索引和偏移。offset 默认 0，limit 默认 50、最多 100；无当前队列项时索引为 -1。",
      inputSchema: queueQuerySchema.shape,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (options) => jsonContent(await playerControl.getQueue(options)),
  );

  const controls = [
    ["play", "继续播放", () => playerControl.play()],
    ["pause", "暂停播放", () => playerControl.pause()],
    ["stop", "停止播放", () => playerControl.stop()],
    ["next_track", "播放下一曲", () => playerControl.next()],
    ["previous_track", "播放上一曲", () => playerControl.prev()],
  ] as const;
  for (const [name, description, run] of controls) {
    server.registerTool(
      name,
      {
        title: description,
        description: `${description}。`,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      () => {
        run();
        return jsonContent({ ok: true });
      },
    );
  }

  server.registerTool(
    "seek",
    {
      title: "跳转播放位置",
      description: "将当前歌曲跳转到指定毫秒位置",
      inputSchema: { positionMs: z.number().finite().min(0) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ positionMs }) => {
      await playerControl.seek(positionMs);
      return jsonContent({ ok: true, positionMs });
    },
  );

  server.registerTool(
    "set_volume",
    {
      title: "设置音量",
      description: "设置播放器音量，取值范围为 0 到 1",
      inputSchema: { volume: z.number().finite().min(0).max(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ volume }) => {
      playerControl.setVolume(volume);
      return jsonContent({ ok: true, volume });
    },
  );

  server.registerTool(
    "play_track",
    {
      title: "播放指定曲目",
      description:
        "将完整 Track 加入播放队列并请求立即播放。可直接使用搜索结果中的曲目。成功表示已派发播放请求。",
      inputSchema: { track: trackSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ track }) => {
      playerControl.playTrack(track);
      return jsonContent({ ok: true, id: track.id });
    },
  );

  server.registerTool(
    "set_play_mode",
    {
      title: "设置播放模式",
      description:
        "设置播放器的循环模式或随机模式。repeat: 循环模式 (list/one), shuffle: 随机播放 (on/off)",
      inputSchema: {
        repeat: z.enum(["list", "one"]).optional(),
        shuffle: z.enum(["on", "off"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ repeat, shuffle }) => {
      if (repeat) {
        playerControl.setRepeat(repeat);
      }
      if (shuffle) {
        playerControl.setShuffle(shuffle);
      }
      return jsonContent({ ok: true, repeat, shuffle });
    },
  );

  server.registerTool(
    "add_to_queue",
    {
      title: "添加到播放队列",
      description:
        "将完整 Track 数组加入播放队列，一次最多 50 首。position 为 next（默认，插入当前歌曲之后）或 end（追加到队列末尾）。",
      inputSchema: {
        tracks: z.array(trackSchema).min(1).max(50),
        position: z.enum(["next", "end"]).default("next"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ tracks, position }) => {
      playerControl.addToQueue(tracks, position);
      return jsonContent({ ok: true, count: tracks.length, position });
    },
  );

  server.registerTool(
    "search_library",
    {
      title: "搜索本地曲库",
      description: "按歌曲名、艺术家或专辑搜索本地曲库，返回匹配的曲目",
      inputSchema: {
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ query, limit }) => jsonContent(searchLibrary(query, limit)),
  );

  server.registerTool(
    "search_online_songs",
    {
      title: "搜索在线歌曲",
      description: "按关键词搜索在线曲目，返回可直接传给 play_track 的曲目",
      inputSchema: onlineSearchSchema.shape,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ platform, query, page, limit }) =>
      jsonContent(await searchOnline({ platform, query, page, limit })),
  );

  server.registerTool(
    "get_random_tracks",
    {
      title: "随机获取曲目",
      description: "从本地曲库随机返回若干首曲目",
      inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    ({ limit }) => {
      const tracks = getRandomTracks(limit);
      return jsonContent({ tracks });
    },
  );

  server.registerTool(
    "list_albums",
    {
      title: "列出专辑",
      description: "列出本地曲库中的专辑摘要，最多返回 100 条",
      inputSchema: { limit: z.number().int().min(1).max(100).default(50) },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ limit }) => {
      const albums = getAlbumList();
      return jsonContent({
        total: albums.length,
        albums: albums.slice(0, limit).map(({ cover: _cover, ...album }) => album),
      });
    },
  );

  server.registerTool(
    "list_artists",
    {
      title: "列出艺术家",
      description: "列出本地曲库中的艺术家摘要，最多返回 100 条",
      inputSchema: { limit: z.number().int().min(1).max(100).default(50) },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ limit }) => {
      const artists = getArtistList();
      return jsonContent({
        total: artists.length,
        artists: artists.slice(0, limit).map(({ cover: _cover, ...artist }) => artist),
      });
    },
  );

  server.registerResource(
    "now-playing",
    "splayer://now-playing",
    {
      title: "SPlayer 当前播放",
      description: "不含完整歌词正文的当前歌曲与播放位置轻量快照",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(nowPlaying.lightSnapshot()),
        },
      ],
    }),
  );

  server.registerResource(
    "library-summary",
    "splayer://library/summary",
    {
      title: "SPlayer 曲库摘要",
      description: "本地曲库的歌曲、专辑和艺术家数量",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            tracks: getTrackCount(),
            albums: getAlbumList().length,
            artists: getArtistList().length,
          }),
        },
      ],
    }),
  );

  return server;
};

/** 创建 SPlayer MCP HTTP 端点 */
export const createMcpEndpoint = (): McpEndpoint => createHttpEndpoint(createServer);
