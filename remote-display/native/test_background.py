"""离线检查背景缓存、歌词留白与尺寸变化；不连接主机。"""
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

os.environ["SURFACE_NATIVE_FIXTURE"] = sys.argv[1]
os.environ["SURFACE_NATIVE_COVER"] = sys.argv[2]
folder = Path(sys.argv[3])
folder.mkdir(parents=True, exist_ok=True)
import player
import cairo
from gi.repository import Gtk, GLib

player.Player.start_ticks = lambda self: None


class Check(Gtk.Application):
    error = None

    def do_activate(self):
        self.window = player.Player(self)
        GLib.timeout_add(500, self.check)

    def check(self):
        w = self.window
        try:
            w.on_allocate(w.area, SimpleNamespace(width=2160, height=1440))
            w.clock.position, w.clock.playing = 68000, False
            w.scroll = w.target(w.current())
            image = cairo.ImageSurface(cairo.FORMAT_ARGB32, 2160, 1440)
            w.draw(w.area, cairo.Context(image))
            assert (w.lyric_top, w.lyric_bottom) == (56, 1360)
            cached = w.background_surface
            assert cached is not None
            reference = cairo.ImageSurface(cairo.FORMAT_ARGB32, 2160, 1440)
            ctx = cairo.Context(reference)
            ctx.set_source_surface(cached)
            ctx.paint()
            # 留白内只有背景，不残留歌词；忽略 RGB24 的未使用字节。
            image.flush()
            reference.flush()
            for y in (0, 30, 1400, 1439):
                for x in range(w.lyric_x, 2160, 50):
                    pos = y * image.get_stride() + x * 4
                    assert bytes(image.get_data()[pos:pos+3]) == bytes(reference.get_data()[pos:pos+3])
            image.write_to_png(str(folder / "preview.png"))
            w.draw(w.area, cairo.Context(image))
            assert w.background_surface is cached
            assert len(set(bytes(reference.get_data())[::100])) > 10
            build_ms = w.background_build_ms
            w.on_allocate(w.area, SimpleNamespace(width=900, height=600))
            assert w.background_surface is None
            image = cairo.ImageSurface(cairo.FORMAT_ARGB32, 900, 600)
            w.draw(w.area, cairo.Context(image))
            assert w.background_surface.get_width() == 900
            w.cover = w.cover_surface = w.background_surface = None
            w.draw(w.area, cairo.Context(image))
            assert w.background_surface is None
            result = dict(passed=True, buildMs=build_ms,
                          checks=["上下留白", "封面背景非纯色", "连续绘制复用背景", "尺寸变化重建缓存", "无封面回退"])
        except Exception as error:
            self.error = repr(error)
            result = dict(passed=False, error=self.error)
        (folder / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(json.dumps(result, ensure_ascii=False), flush=True)
        w.destroy()
        self.quit()
        return False


app = Check()
app.run([])
sys.exit(bool(app.error))
