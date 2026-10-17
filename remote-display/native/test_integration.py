"""Surface 本机模拟服务器测试；不连接真实主机或操作音乐。"""
import copy
import json
import os
from pathlib import Path
import sys
import time

os.environ.pop("SURFACE_NATIVE_FIXTURE", None)
os.environ["SURFACE_PLAYER_HOST"] = "http://127.0.0.1:17658"
import player
from gi.repository import Gtk, Soup, GLib


class Integration(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="org.neclyon.SurfaceNativeTest")
        self.checks = []
        self.connections = []
        self.commands = []
        self.spectrum_clients = set()
        self.spectrum_timer = GLib.timeout_add(50, self.spectrum)
        self.failed = None
        self.server = Soup.Server()
        self.server.add_websocket_handler("/ws", None, None, self.websocket)
        self.server.add_handler("/api/display/cover", lambda _s, m, *_: m.set_status(404, None))
        self.server.listen_local(17658, Soup.ServerListenOptions.IPV4_ONLY)
        self.fixture = json.loads(Path(sys.argv[1]).read_text())
        self.fixture.update(position=160000, playing=True, speed=1, lyricOffsetMs=0, duration=200000)
        self.fixture["trackId"] = self.fixture["track"]["id"]
        self.anchor = time.monotonic()

    def state(self):
        data = copy.deepcopy(self.fixture)
        if data["playing"]:
            data["position"] += (time.monotonic() - self.anchor) * 1000
        data["sendTimestamp"] = time.time() * 1000
        return data

    def websocket(self, _server, _message, _path, ws, *_):
        self.connections.append(ws)
        def message(ws, _kind, raw):
            value = json.loads(raw.get_data())
            self.commands.append(value)
            if value["op"] == "display-ping":
                ws.send_text(json.dumps(dict(kind="display-pong", clientTime=value["clientTime"], serverTime=time.time() * 1000)))
            elif value["op"] == "subscribe-display" and value["visible"]:
                if value.get("spectrum"):
                    self.spectrum_clients.add(ws)
                ws.send_text(json.dumps(dict(kind="display-snapshot", data=self.state())))
            elif value["op"] == "subscribe-display":
                self.spectrum_clients.discard(ws)
        ws.connect("message", message)

    def spectrum(self):
        if self.fixture["playing"]:
            for ws in list(self.spectrum_clients):
                if ws.get_state() == Soup.WebsocketState.OPEN:
                    ws.send_binary(b"SPF1" + bytes([200] * 128))
                else:
                    self.spectrum_clients.discard(ws)
        return True

    def send(self, kind, data):
        self.connections[-1].send_text(json.dumps(dict(kind=kind, data=data)))

    def position(self, value, playing=True):
        self.fixture.update(position=value, playing=playing)
        self.anchor = time.monotonic()
        self.send("display-position", self.state())

    def check(self, name, condition):
        if not condition:
            raise AssertionError(name)
        self.checks.append(name)

    def later(self, seconds, callback):
        def run():
            try:
                callback()
            except Exception as error:
                self.failed = repr(error)
                self.finish()
            return False
        GLib.timeout_add(int(seconds * 1000), run)

    def do_activate(self):
        self.window = player.Player(self)
        disconnected = self.window.disconnected
        self.disconnect_observed = False
        def lost():
            disconnected()
            self.disconnect_observed = not self.window.connected and not self.window.clock.playing
        self.window.disconnected = lost
        self.later(1, self.pause)
        self.later(2, self.paused)
        self.later(3, self.seek)
        self.later(4, self.hide)
        self.later(5, self.show)
        self.later(6, self.drop)
        self.later(7.5, self.resize)
        self.later(8.5, self.fullscreen)
        self.later(9.5, self.replace)
        self.later(11, self.long_song)
        self.later(13, self.long_seek)
        self.later(15, self.finish)

    def pause(self):
        self.check("收到二进制频谱并绘制", self.window.spectrum_frames > 0 and max(self.window.spectrum.levels) > 0)
        self.check("快照、字体与完整歌词已载入", self.window.connected and len(self.window.lines) == len(self.fixture["lyric"]))
        self.position(161000, False)

    def paused(self):
        self.check("暂停后频谱清空并停止回调", max(self.window.spectrum.levels) == 0 and self.window.spectrum_source == 0)
        self.check("暂停后时间与绘制回调停止", abs(self.window.current() - 161000) < 1 and self.window.tick_id == 0)
        self.position(161000)

    def seek(self):
        self.check("恢复播放时钟推进", self.window.current() > 161500)
        self.position(30000)

    def hide(self):
        self.check("向后跳转正确", 30000 < self.window.current() < 32000)
        self.window.iconify()

    def show(self):
        self.check("隐藏后频谱回调停止", self.window.spectrum_source == 0)
        self.check("隐藏窗口取消高频订阅和绘制", not self.window.visible and self.window.tick_id == 0 and any(c.get("visible") is False for c in self.commands))
        self.window.deiconify()
        self.window.present()

    def drop(self):
        self.check("重新显示恢复订阅", self.window.visible and self.window.connected)
        self.connections[-1].close(1001, "test disconnect")

    def resize(self):
        self.check("断线冻结后自动重连", self.disconnect_observed and len(self.connections) >= 2 and self.window.connected)
        self.window.unfullscreen()
        self.window.resize(900, 600)

    def fullscreen(self):
        self.check("尺寸变化重新排版", self.window.width < 2160)
        self.window.fullscreen()

    def replace(self):
        self.fixture["track"] = dict(id="mixed", title="Ruby 注音 / 对唱 / 和声", artists=[])
        self.fixture["trackId"] = "mixed"
        words = [dict(word="星光 ", startTime=0, endTime=2000, romanWord="xing guang"),
                 dict(word="照亮 ", startTime=2000, endTime=4000, ruby=[dict(word="てらす", startTime=2000, endTime=4000)]),
                 dict(word="Everything flows", startTime=4000, endTime=7000)]
        self.fixture["lyric"] = [dict(words=words, startTime=0, endTime=7000, isBG=False, isDuet=False, translatedLyric="混合字体与注音"),
                                 dict(words=words, startTime=1000, endTime=7000, isBG=True, isDuet=True)]
        self.fixture.update(position=0, playing=True)
        self.anchor = time.monotonic()
        self.send("display-snapshot", self.state())

    def long_song(self):
        self.check("切歌清除旧缓存并绘制混合文字", self.window.track_id == "mixed" and len(self.window.lines) == 2 and len(self.window.cache) == 2)
        line = self.fixture["lyric"][0]
        self.fixture["lyric"] = []
        for i in range(1000):
            row = copy.deepcopy(line)
            row["startTime"], row["endTime"] = i * 8000, i * 8000 + 7000
            for word in row["words"]:
                word["startTime"] += i * 8000
                word["endTime"] += i * 8000
            self.fixture["lyric"].append(row)
        self.fixture["duration"] = 8000000
        self.send("display-snapshot", self.state())

    def long_seek(self):
        self.check("长歌词初始化完成", len(self.window.lines) == 1000)
        self.position(7900000)

    def finish(self):
        if not self.failed:
            try:
                self.check("长歌词跳转后缓存有界", len(self.window.cache) <= 24 and self.window.cache_bytes <= 32 * 1024 ** 2 and self.window.current() > 7900000)
                self.check("所有网络命令均为只读订阅或校时", all(c["op"] in ("display-ping", "subscribe-display") for c in self.commands))
            except AssertionError as error:
                self.failed = str(error)
        result = dict(passed=self.failed is None, checks=self.checks, error=self.failed, connections=len(self.connections), cacheMiB=self.window.cache_bytes / 1024 ** 2)
        print(json.dumps(result, ensure_ascii=False), flush=True)
        Path.home().joinpath(".local/state/surface-player-native/integration.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
        self.window.destroy()
        GLib.source_remove(self.spectrum_timer)
        self.server.disconnect()
        self.quit()


app = Integration()
app.run([])
sys.exit(1 if app.failed else 0)
