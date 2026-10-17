"""离线检查真实 Cairo 绘图的渐暗与间奏布局，不连接或控制主机。"""
import json
import os
from pathlib import Path
import sys
import tempfile

folder = Path(sys.argv[1])
folder.mkdir(parents=True, exist_ok=True)
fixture = {
    "track": {"id": "effects", "title": "原生动画检查", "artists": []},
    "source": {"format": "ttml"}, "duration": 40000,
    "lyric": [
        {"startTime": 0, "endTime": 4000, "words": [{"word": "第一句渐暗 / First line fades", "startTime": 0, "endTime": 4000}]},
        {"startTime": 16000, "endTime": 21000, "words": [{"word": "下一句开始 / The next line begins", "startTime": 16000, "endTime": 21000}]},
        {"startTime": 28000, "endTime": 32000, "isDuet": True, "words": [{"word": "对唱 / Duet", "startTime": 28000, "endTime": 32000}]},
    ],
}
with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as file:
    json.dump(fixture, file)
    fixture_path = file.name
os.environ["SURFACE_NATIVE_FIXTURE"] = fixture_path
os.environ["SURFACE_NATIVE_START"] = "0"
import player
from gi.repository import Gtk, GLib
import cairo

# 在固定媒体时间截取画面，避免测试进程继续推进播放时间。
player.Player.start_ticks = lambda self: None


class Effects(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="org.neclyon.SurfaceEffectsTest")
        self.error = None

    def do_activate(self):
        self.window = player.Player(self)
        GLib.timeout_add(500, self.check)

    def position(self, value):
        w = self.window
        w.clock.playing = False
        w.clock.position = value
        w.clock.at = player.now_ms()

    def check(self):
        w = self.window
        try:
            levels = []
            for timestamp in (4000, 4001, 4225, 4450):
                self.position(timestamp)
                w.scroll = 0
                image = cairo.ImageSurface(cairo.FORMAT_ARGB32, w.lyric_width, w.heights[0])
                ctx = cairo.Context(image)
                ctx.translate(-w.lyric_x, 0)
                w.draw(w.area, ctx)
                image.flush()
                levels.append(max(bytes(image.get_data())[0::4]))
                image.write_to_png(str(folder / f"fade-{timestamp}.png"))
            assert abs(levels[0] - levels[1]) <= 1, levels
            assert levels[0] > levels[2] > levels[3], levels
            self.position(10000)
            w.snap = True
            w.update_interlude(w.current(), .016)
            w.scroll = w.target(w.current())
            assert w.dot_gap == (4000, 16000, 1), w.dot_gap
            assert w.dot_space > 0
            image = cairo.ImageSurface(cairo.FORMAT_ARGB32, w.width, w.height)
            w.draw(w.area, cairo.Context(image))
            image.write_to_png(str(folder / "interlude.png"))
            frozen = player.interlude_visual(w.dot_gap, w.current())
            assert frozen[1] > .99 and frozen[2][0] > frozen[2][2]
            self.position(16000)
            w.snap = False
            w.update_interlude(w.current(), .016)
            assert w.dot_gap is None and w.dot_space > 0
            for _ in range(120):
                w.update_interlude(w.current(), 1 / 60)
            assert w.dot_anchor is None and w.dot_space == 0
            self.position(25000)
            w.snap = True
            w.update_interlude(w.current(), .016)
            assert w.dot_gap == (21000, 28000, 2)
            self.position(3000)
            w.update_interlude(w.current(), .016)
            assert w.dot_gap is None and w.dot_space == 0
            result = {"passed": True, "fadePixelLevels": levels,
                      "checks": ["行末亮度连续", "高亮字形逐渐变暗", "间奏占位与点亮", "开唱后平滑收起", "对唱间奏", "跳转清理间奏"]}
        except Exception as error:
            self.error = repr(error)
            result = {"passed": False, "error": self.error}
        (folder / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(json.dumps(result, ensure_ascii=False), flush=True)
        w.destroy()
        self.quit()
        return False


app = Effects()
app.run([])
Path(fixture_path).unlink()
sys.exit(1 if app.error else 0)
