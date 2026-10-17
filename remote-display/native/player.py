#!/usr/bin/python3
"""只接收播放信息的 GTK/Pango/Cairo 显示端，不载入 Web 引擎。"""
import bisect
from collections import OrderedDict
import json
import math
import os
from pathlib import Path
import statistics
import time
from urllib.parse import quote, urlsplit

import cairo
import gi

for module, version in [("Gtk", "3.0"), ("Gdk", "3.0"), ("Pango", "1.0"),
                        ("PangoCairo", "1.0"), ("Soup", "3.0"), ("GdkPixbuf", "2.0")]:
    gi.require_version(module, version)
from gi.repository import Gtk, Gdk, GLib, Gio, Pango, PangoCairo, Soup, GdkPixbuf
from model import Clock, smooth_scroll, progress, line_emphasis, find_interludes, interlude_visual
from background import build_background
from spectrum import Spectrum

HOST = os.environ.get("SURFACE_PLAYER_HOST", "http://192.168.2.38:14558").rstrip("/")
STATUS = Path.home() / ".local/state/surface-player-native/status.json"
BENCH = os.environ.get("SURFACE_NATIVE_FIXTURE")
BENCH_START = float(os.environ.get("SURFACE_NATIVE_START", "160000"))
FONT = "LXGW WenKai,霞鹜文楷"
BG = (28 / 255, 29 / 255, 39 / 255)


def now_ms():
    return time.monotonic() * 1000


class Player(Gtk.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="Surface Player · Native")
        self.set_default_size(1440, 960)
        self.full = True
        self.closed = False
        self.visible = True
        self.clock = Clock()
        self.connected = False
        self.ws = None
        self.session = Soup.Session(timeout=15)
        self.cancel = Gio.Cancellable()
        self.retry_source = self.heartbeat_source = self.tick_id = 0
        self.retry = 0
        self.last_message = 0
        self.track = None
        self.track_id = None
        self.cover_key = None
        self.cover_cancel = None
        self.cover = None
        self.cover_surface = None
        self.background_surface = None
        self.background_edges = []
        self.background_build_ms = 0
        self.lyric_top, self.lyric_bottom = 56, 80
        self.lyric_fade = None
        self.spectrum = Spectrum()
        self.spectrum_source = 0
        self.spectrum_frames = 0
        self.spectrum_scale = 1
        self.spectrum_height = 80
        self.cover_generation = 0
        self.source = {}
        self.lines = []
        self.offset = self.duration = 0
        self.width = self.height = 0
        self.lyric_x = self.lyric_width = self.font_size = 1
        self.heights = self.tops = self.main_indices = self.starts = []
        self.cache = OrderedDict()
        self.cache_bytes = 0
        self.cache_peak = 0
        self.scroll = self.velocity = 0.0
        self.interludes = []
        self.interlude_starts = []
        self.dot_gap = None
        self.dot_anchor = None
        self.dot_space = self.dot_velocity = 0.0
        self.snap = True
        self.last_tick = 0
        self.last_wall_tick = 0
        self.frame_start = now_ms()
        self.frame_count = self.fps = 0
        self.bench_at = None
        self.bench_wall_at = None
        self.bench_frames = []
        self.bench_draws = []
        self.bench_result = None
        self.area = Gtk.DrawingArea()
        self.area.connect("draw", self.draw)
        self.area.connect("size-allocate", self.on_allocate)
        self.add(self.area)
        self.add_events(Gdk.EventMask.VISIBILITY_NOTIFY_MASK)
        self.connect("visibility-notify-event", self.visibility)
        self.connect("window-state-event", self.window_state)
        self.connect("key-press-event", self.key)
        self.connect("destroy", self.shutdown)
        self.show_all()
        self.fullscreen()
        self.status_source = GLib.timeout_add_seconds(5, self.diagnostics)
        if BENCH:
            GLib.idle_add(self.load_bench)
        else:
            self.connect_host()

    def text_layout(self, text, size, width, align=False, bold=False):
        layout = self.area.create_pango_layout(text)
        font = Pango.FontDescription()
        font.set_family(FONT)
        font.set_absolute_size(size * Pango.SCALE)
        if bold:
            font.set_weight(Pango.Weight.SEMIBOLD)
        layout.set_font_description(font)
        # 明确指定拉丁文字字体，避免系统回退顺序使英文也采用文楷。
        attrs = Pango.AttrList()
        byte_offset = 0
        run_start = None
        for char in text + "\uffff":
            latin = ord(char) < 0x0250 or 0x2000 <= ord(char) <= 0x206f
            if latin and run_start is None:
                run_start = byte_offset
            elif not latin and run_start is not None:
                attr = Pango.attr_family_new("Times New Roman")
                attr.start_index, attr.end_index = run_start, byte_offset
                attrs.insert(attr)
                run_start = None
            byte_offset += len(char.encode("utf-8"))
        layout.set_attributes(attrs)
        layout.set_width(int(width * Pango.SCALE))
        layout.set_wrap(Pango.WrapMode.WORD_CHAR)
        layout.set_alignment(Pango.Alignment.RIGHT if align else Pango.Alignment.LEFT)
        return layout

    def on_allocate(self, _area, rect):
        if (self.width, self.height) == (rect.width, rect.height):
            return
        self.width, self.height = rect.width, rect.height
        portrait = self.height > self.width
        self.lyric_x = int(self.width * (0.39 if portrait else 0.48))
        self.lyric_width = int(self.width * 0.98) - self.lyric_x
        self.font_size = self.height * (0.03 if portrait else 0.041) * 1.07
        self.spectrum_scale = max(1, self.get_screen().get_resolution() / 96)
        self.spectrum_height = math.ceil(80 * self.spectrum_scale)
        self.cover_surface = None
        self.background_surface = None
        self.background_edges = []
        # 对应 FullPlayer 的 top-14 / bottom-20，按 GTK 逻辑像素保留留白。
        self.lyric_top = min(56, self.height * .2)
        self.lyric_bottom = max(self.lyric_top + 1, self.height - min(80, self.height * .2))
        self.lyric_fade = cairo.LinearGradient(0, self.lyric_top, 0, self.lyric_bottom)
        for stop, alpha in [(0, 1), (.05, .4), (.1, 0), (.75, 0), (.85, .4), (1, 1)]:
            self.lyric_fade.add_color_stop_rgba(stop, 1, 1, 1, alpha)
        self.reflow()

    def row_layout(self, line):
        size = self.font_size * (0.7 if line.get("isBG") else 1)
        pad = self.font_size * 0.75
        width = max(20, self.lyric_width - pad * 2)
        words = line.get("words", [])
        text = "".join(w["word"] for w in words)
        layout = self.text_layout(text, size, width, line.get("isDuet", False))
        annotations = any(w.get("ruby") for w in words)
        top = size * 0.55 if annotations else 0
        if annotations:
            layout.set_spacing(int(size * 0.6 * Pango.SCALE))
        body_height = layout.get_pixel_size()[1]
        # 两种音译数据统一放在下方；Ruby 独占原文字词上方，不互相覆盖。
        roman = line.get("romanLyric", "").strip()
        if not roman:
            roman = " ".join(w.get("romanWord", "").strip() for w in words
                             if w.get("romanWord", "").strip())
        subtitle = "\n".join(part for part in (roman, line.get("translatedLyric", "").strip()) if part)
        sub = self.text_layout(subtitle, size * 0.5, width, line.get("isDuet", False)) if subtitle else None
        sub_y = top + body_height + size * 0.16
        height = sub_y + (sub.get_pixel_size()[1] if sub else 0) + size * 0.8
        return layout, sub, top, sub_y, math.ceil(height), size, pad

    def reflow(self):
        self.cache.clear()
        self.cache_bytes = 0
        self.tops, self.heights = [], []
        position = 0
        for line in self.lines:
            self.tops.append(position)
            height = self.row_layout(line)[4]
            self.heights.append(height)
            position += height
        self.main_indices = [i for i, line in enumerate(self.lines) if not line.get("isBG")]
        self.starts = [self.lines[i]["startTime"] for i in self.main_indices]
        self.interludes = find_interludes(self.lines)
        self.interlude_starts = [gap[0] for gap in self.interludes]
        self.dot_gap = self.dot_anchor = None
        self.dot_space = self.dot_velocity = 0.0
        self.snap = True
        self.area.queue_draw()
        self.start_ticks()

    @staticmethod
    def rectangles(layout, text, byte_offset):
        result = []
        for char in text:
            rect = layout.index_to_pos(byte_offset)
            x, y, w, h = [v / Pango.SCALE for v in (rect.x, rect.y, rect.width, rect.height)]
            rtl = w < 0
            if rtl:
                x, w = x + w, -w
            if w > 0:
                if result and result[-1][1] == y and result[-1][4] == rtl and abs(result[-1][0] + result[-1][2] - x) < 1:
                    result[-1][2] += w
                else:
                    result.append([x, y, w, h, rtl])
            byte_offset += len(char.encode("utf-8"))
        return result, byte_offset

    def raster(self, index):
        if index in self.cache:
            self.cache.move_to_end(index)
            return self.cache[index]
        line = self.lines[index]
        layout, sub, top, sub_y, height, size, pad = self.row_layout(line)
        scale = self.area.get_scale_factor()
        surface = cairo.ImageSurface(cairo.FORMAT_A8, math.ceil(self.lyric_width * scale), math.ceil(height * scale))
        surface.set_device_scale(scale, scale)
        ctx = cairo.Context(surface)
        ctx.set_source_rgba(1, 1, 1, 1)
        ctx.move_to(pad, top)
        PangoCairo.show_layout(ctx, layout)
        boxes = []
        offset = 0
        for word in line.get("words", []):
            segments, offset = self.rectangles(layout, word["word"], offset)
            translated = [(x + pad, y + top, w, h, rtl) for x, y, w, h, rtl in segments]
            boxes.append((word["startTime"], word["endTime"], translated))
            annotation = "".join(r["word"] for r in word.get("ruby", []))
            if annotation and segments:
                x, y, w, _h, _rtl = segments[0]
                note = self.text_layout(annotation, size * 0.42, max(w, size * 4))
                note.set_width(-1)
                nw, nh = note.get_pixel_size()
                ctx.move_to(pad + x + (w - nw) / 2, top + y - nh)
                PangoCairo.show_layout(ctx, note)
        if sub:
            ctx.set_source_rgba(1, 1, 1, 1)
            ctx.move_to(pad, sub_y)
            PangoCairo.show_layout(ctx, sub)
        size_bytes = surface.get_stride() * surface.get_height()
        value = (surface, boxes, size_bytes)
        self.cache[index] = value
        self.cache_bytes += size_bytes
        while len(self.cache) > 24 or (self.cache_bytes > 32 * 1024 * 1024 and len(self.cache) > 1):
            _, old = self.cache.popitem(last=False)
            self.cache_bytes -= old[2]
        self.cache_peak = max(self.cache_peak, self.cache_bytes)
        return value

    def current(self):
        return min(self.duration or math.inf, self.clock.current(now_ms())) + self.offset

    def target(self, position):
        if not self.main_indices:
            return 0
        anchor = self.lyric_top + (self.lyric_bottom - self.lyric_top) * .35
        if self.dot_gap:
            return self.tops[self.dot_anchor] - anchor
        active = max(0, bisect.bisect_right(self.starts, position) - 1)
        index = self.main_indices[active]
        extra = self.dot_space if self.dot_anchor is not None and index >= self.dot_anchor else 0
        return self.tops[index] + extra - anchor

    def update_interlude(self, position, delta):
        index = bisect.bisect_right(self.interlude_starts, position) - 1
        gap = self.interludes[index] if index >= 0 else None
        if gap and position >= gap[1]:
            gap = None
        self.dot_gap = gap
        if gap:
            self.dot_anchor = gap[2]
        goal = self.font_size * 1.65 if gap else 0
        if self.snap:
            self.dot_space, self.dot_velocity = goal, 0
        else:
            self.dot_space, self.dot_velocity = smooth_scroll(self.dot_space, self.dot_velocity, goal, delta)
        if not gap and self.dot_space == 0:
            self.dot_anchor = None

    def start_ticks(self):
        if self.lines and not self.tick_id and self.visible and not self.closed:
            self.last_tick = 0
            self.tick_id = self.area.add_tick_callback(self.tick)

    def tick(self, _area, frame_clock):
        now = frame_clock.get_frame_time() / 1000
        wall = now_ms()
        wall_delta = wall - self.last_wall_tick if self.last_wall_tick else 1000 / 60
        self.last_wall_tick = wall
        delta = now - self.last_tick if self.last_tick else 1000 / 60
        self.last_tick = now
        if BENCH and self.bench_at is None:
            self.bench_at = now
            self.bench_wall_at = wall
            self.clock.position, self.clock.at = BENCH_START, now_ms()
        position = self.current()
        self.update_interlude(position, min(.1, delta / 1000))
        target = self.target(position)
        if self.snap:
            self.scroll, self.velocity, self.snap = target, 0, False
        else:
            self.scroll, self.velocity = smooth_scroll(self.scroll, self.velocity, target, min(0.1, delta / 1000))
        self.area.queue_draw_area(self.lyric_x, int(self.lyric_top), self.width - self.lyric_x,
                                  math.ceil(self.lyric_bottom - self.lyric_top))
        self.frame_count += 1
        if now_ms() - self.frame_start > 1000:
            self.fps = self.frame_count * 1000 / (now_ms() - self.frame_start)
            self.frame_count, self.frame_start = 0, now_ms()
        if BENCH:
            elapsed = wall - self.bench_wall_at
            if elapsed > 2000:
                self.bench_frames.append(wall_delta)
            if elapsed >= 22000:
                frames = sorted(self.bench_frames)
                self.bench_result = {
                    "done": True, "renderer": "Pango-Cairo", "frames": len(frames),
                    "fps": 1000 * len(frames) / sum(frames),
                    "p95FrameMs": frames[int(len(frames) * .95)],
                    "p99FrameMs": frames[int(len(frames) * .99)],
                    "over33ms": sum(f > 33.4 for f in frames),
                    "drawMeanMs": statistics.mean(self.bench_draws) if self.bench_draws else 0,
                    "cacheMiB": self.cache_bytes / 1024 ** 2,
                    "cachePeakMiB": self.cache_peak / 1024 ** 2,
                    "viewport": [self.width, self.height],
                    "scale": self.area.get_scale_factor(),
                }
                self.clock.freeze(now_ms())
                self.tick_id = 0
                self.diagnostics()
                return False
        if not self.visible or (not self.clock.playing and self.velocity == 0 and self.dot_velocity == 0 and self.scroll == target):
            self.tick_id = 0
            return False
        return True

    def draw(self, _area, ctx):
        before = time.perf_counter()
        clip = ctx.clip_extents()
        if self.cover and self.background_surface is None:
            scale = self.area.get_scale_factor()
            image = build_background(self.cover, self.width, self.height, scale)
            # 上传一次到 X11 可复用的 pixmap，避免每帧从 Python 图像内存传输背景。
            self.background_surface = self.get_window().create_similar_surface(
                cairo.CONTENT_COLOR, math.ceil(self.width * scale), math.ceil(self.height * scale))
            self.background_surface.set_device_scale(scale, scale)
            cached = cairo.Context(self.background_surface)
            cached.set_source_surface(image)
            cached.paint()
            self.background_edges = []
            span = self.lyric_bottom - self.lyric_top
            for top, bottom in [(self.lyric_top, self.lyric_top + span * .1),
                                (self.lyric_top + span * .75, self.lyric_bottom)]:
                top, bottom = math.floor(top), math.ceil(bottom)
                edge = self.get_window().create_similar_surface(
                    cairo.CONTENT_COLOR_ALPHA, math.ceil(self.lyric_width * scale), math.ceil((bottom - top) * scale))
                edge.set_device_scale(scale, scale)
                cached = cairo.Context(edge)
                cached.translate(-self.lyric_x, -top)
                cached.set_source_surface(self.background_surface)
                cached.mask(self.lyric_fade)
                self.background_edges.append((edge, top))
            self.background_build_ms = (time.perf_counter() - before) * 1000
        if self.background_surface:
            ctx.set_source_surface(self.background_surface)
        else:
            ctx.set_source_rgb(*BG)
        ctx.paint()
        ctx.save()
        ctx.rectangle(0, 0, self.lyric_x, self.height - self.spectrum_height)
        ctx.clip()
        record_clip = ctx.clip_extents()
        ctx.restore()
        if record_clip[2] > record_clip[0] and record_clip[3] > record_clip[1]:
            self.draw_record(ctx)
        ctx.save()
        ctx.rectangle(self.lyric_x, self.lyric_top, self.lyric_width, self.lyric_bottom - self.lyric_top)
        ctx.clip()
        position = self.current()
        start = max(0, bisect.bisect_right(self.tops, self.scroll + self.lyric_top - self.dot_space) - 1)
        for index in range(start, len(self.lines)):
            y = self.tops[index] - self.scroll
            if self.dot_anchor is not None and index >= self.dot_anchor:
                y += self.dot_space
            if y > self.lyric_bottom:
                break
            surface, boxes, _ = self.raster(index)
            line = self.lines[index]
            emphasis = line_emphasis(line["startTime"], line["endTime"], position)
            base_alpha = .24 + .18 * emphasis
            ctx.set_source_rgba(1, 1, 1, base_alpha)
            ctx.mask_surface(surface, self.lyric_x, y)
            if emphasis > 0:
                ctx.save()
                if str(self.source.get("format", "")).lower() == "lrc":
                    ctx.rectangle(self.lyric_x, y, self.lyric_width, self.heights[index])
                else:
                    for begin, end, segments in boxes:
                        fraction = progress(begin, end, position)
                        remaining = sum(s[2] for s in segments) * fraction
                        for x, sy, width, height, rtl in segments:
                            fill = min(width, remaining)
                            if fill > 0:
                                ctx.rectangle(self.lyric_x + x + (width - fill if rtl else 0), y + sy, fill, height)
                            remaining -= fill
                ctx.clip()
                bright_alpha = .24 + ((.95 if not line.get("isBG") else .65) - .24) * emphasis
                ctx.set_source_rgba(1, 1, 1, (bright_alpha - base_alpha) / (1 - base_alpha))
                ctx.mask_surface(surface, self.lyric_x, y)
                ctx.restore()
        self.draw_interlude(ctx, position)
        if not self.lines:
            layout = self.text_layout("暂无歌词" if self.track else "等待主机播放", self.height * .025, self.lyric_width)
            ctx.set_source_rgba(1, 1, 1, .4)
            ctx.move_to(self.lyric_x + self.lyric_width * .35, self.height * .45)
            PangoCairo.show_layout(ctx, layout)
        # 用缓存背景覆盖边缘实现原版透明度遮罩，避免每帧分配整块歌词离屏图层。
        if self.lyric_fade:
            if self.background_surface:
                for edge, top in self.background_edges:
                    ctx.set_source_surface(edge, self.lyric_x, top)
                    ctx.paint()
            else:
                ctx.set_source_rgb(*BG)
                span = self.lyric_bottom - self.lyric_top
                ctx.rectangle(self.lyric_x, self.lyric_top, self.lyric_width, span * .1)
                ctx.rectangle(self.lyric_x, self.lyric_top + span * .75, self.lyric_width, span * .25)
                ctx.clip()
                ctx.mask(self.lyric_fade)
        ctx.restore()
        if clip[3] > self.height - self.spectrum_height:
            self.draw_spectrum(ctx)
        if not self.connected:
            ctx.set_source_rgba(1, .35, .35, .18)
            ctx.paint()
        if BENCH and self.bench_at and not self.bench_result:
            self.bench_draws.append((time.perf_counter() - before) * 1000)
        return False

    def draw_spectrum(self, ctx):
        width = min(1920 * self.spectrum_scale, self.width)
        left = (self.width - width) / 2
        bar_width = 4 * self.spectrum_scale
        slot = 7 * self.spectrum_scale
        count = int(width / slot)
        if count == 0:
            return
        fill = cairo.LinearGradient(left, 0, left + width, 0)
        for stop, alpha in [(0, 0), (.05, .39), (.12, .65), (.88, .65), (.95, .39), (1, 0)]:
            fill.add_color_stop_rgba(stop, 1, 1, 1, alpha)
        ctx.set_source(fill)
        # 对应原版按柱数重采样及邻频均值，避免把每个传输频段直接拉成粗柱。
        for index in range(count):
            start = math.floor(index * 128 / count)
            end = math.floor((index + 1) * 128 / count)
            lo, hi = max(0, start - 1), min(128, max(end, start + 1) + 1)
            value = sum(self.spectrum.levels[lo:hi]) / (hi - lo)
            height = value * self.spectrum_height
            if height > .5:
                x, y = left + index * slot, self.height - height
                width = bar_width
                radius = min(2 * self.spectrum_scale, width / 2, height / 2)
                ctx.new_sub_path()
                for cx, cy, angle in [(x + width - radius, y + radius, -math.pi / 2),
                                      (x + width - radius, y + height - radius, 0),
                                      (x + radius, y + height - radius, math.pi / 2),
                                      (x + radius, y + radius, math.pi)]:
                    ctx.arc(cx, cy, radius, angle, angle + math.pi / 2)
                ctx.close_path()
        ctx.fill()

    def spectrum_tick(self):
        active = self.connected and self.visible and self.clock.playing and not self.closed
        if active:
            active = self.spectrum.update(now_ms())
        else:
            self.spectrum.reset()
        self.area.queue_draw_area(0, max(0, self.height - self.spectrum_height), self.width, min(self.spectrum_height, self.height))
        if not active:
            self.spectrum_source = 0
        return active

    def clear_spectrum(self):
        if self.spectrum_source:
            GLib.source_remove(self.spectrum_source)
            self.spectrum_source = 0
        self.spectrum.reset()
        self.area.queue_draw_area(0, max(0, self.height - self.spectrum_height), self.width, min(self.spectrum_height, self.height))

    def draw_interlude(self, ctx, position):
        if not self.dot_gap:
            return
        scale, alpha, dots = interlude_visual(self.dot_gap, position)
        if alpha <= 0:
            return
        radius = self.font_size * .15
        spacing = self.font_size * .48
        margin = self.font_size * .75
        if self.lines[self.dot_anchor].get("isDuet"):
            x = self.lyric_x + self.lyric_width - margin - spacing - radius
        else:
            x = self.lyric_x + margin + spacing + radius
        y = self.tops[self.dot_anchor] - self.scroll + self.font_size * .6
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(scale, scale)
        for index, opacity in enumerate(dots):
            ctx.new_path()
            ctx.arc((index - 1) * spacing, 0, radius, 0, 2 * math.pi)
            ctx.set_source_rgba(1, 1, 1, alpha * opacity)
            ctx.fill()
        ctx.restore()

    def draw_record(self, ctx):
        left = self.width * .065
        cover_size = min(self.height * .49, self.lyric_x - left - self.width * .05)
        top = (self.height - cover_size - self.height * .16) / 2
        ctx.save()
        radius = self.height * .025
        for x, y, begin in [(left + cover_size - radius, top + radius, -math.pi / 2),
                             (left + cover_size - radius, top + cover_size - radius, 0),
                             (left + radius, top + cover_size - radius, math.pi / 2),
                             (left + radius, top + radius, math.pi)]:
            ctx.arc(x, y, radius, begin, begin + math.pi / 2)
        ctx.close_path()
        ctx.clip()
        if self.cover:
            if self.cover_surface is None:
                scale = self.area.get_scale_factor()
                edge = max(1, math.ceil(cover_size * scale))
                factor = edge / min(self.cover.get_width(), self.cover.get_height())
                scaled = self.cover.scale_simple(math.ceil(self.cover.get_width() * factor), math.ceil(self.cover.get_height() * factor), GdkPixbuf.InterpType.BILINEAR)
                self.cover_surface = Gdk.cairo_surface_create_from_pixbuf(scaled, scale, self.get_window())
            ctx.set_source_surface(self.cover_surface, left, top)
            ctx.paint()
        else:
            ctx.set_source_rgb(.2, .21, .26)
            ctx.paint()
        ctx.restore()
        track = self.track or {}
        labels = [
            (track.get("title", "等待主机播放"), .028, 1, True),
            (" / ".join(a["name"] for a in track.get("artists", [])), .018, .7, False),
            ((track.get("album") or {}).get("name", ""), .018, .4, False),
        ]
        y = top + cover_size + self.height * .024
        for text, ratio, alpha, bold in labels:
            layout = self.text_layout(text, self.height * ratio, self.lyric_x - left - self.width * .04, bold=bold)
            layout.set_ellipsize(Pango.EllipsizeMode.END)
            layout.set_height(-2 if bold else -1)
            ctx.move_to(left, y)
            ctx.set_source_rgba(1, 1, 1, alpha)
            PangoCairo.show_layout(ctx, layout)
            y += layout.get_pixel_size()[1] + self.height * .007

    def snapshot(self, data):
        track = data.get("track")
        track_id = track.get("id") if track else None
        changed = track_id != self.track_id
        if changed or not data["playing"]:
            self.clear_spectrum()
        self.track, self.track_id = track, track_id
        self.source = data.get("source") or {}
        self.offset, self.duration = data.get("lyricOffsetMs", 0), data.get("duration", 0)
        self.clock.sync(data, now_ms(), changed)
        self.lines = sorted(data.get("lyric", []), key=lambda line: (line["startTime"], bool(line.get("isBG"))))
        self.connected = True
        self.reflow()
        cover_key = (track_id, (track or {}).get("coverOriginal") or (track or {}).get("cover"))
        if not BENCH and cover_key != self.cover_key:
            self.cover_key = cover_key
            self.load_cover()
        self.area.queue_draw()

    def load_cover(self):
        self.cover_generation += 1
        token = self.cover_generation
        self.cover = self.cover_surface = self.background_surface = None
        self.background_edges = []
        if self.cover_cancel:
            self.cover_cancel.cancel()
        self.cover_cancel = Gio.Cancellable()
        message = Soup.Message.new("GET", HOST + "/api/display/cover?trackId=" + quote(str(self.track_id or ""), safe=""))
        def complete(session, result):
            try:
                data = session.send_and_read_finish(result).get_data()
                if self.closed or token != self.cover_generation or message.get_status() != 200:
                    return
                loader = GdkPixbuf.PixbufLoader()
                def sized(loader, width, height):
                    factor = min(1, max(1, self.height * .55) / max(width, height))
                    loader.set_size(max(1, int(width * factor)), max(1, int(height * factor)))
                loader.connect("size-prepared", sized)
                loader.write(data)
                loader.close()
                self.cover = loader.get_pixbuf()
                self.area.queue_draw()
            except GLib.Error:
                pass
        self.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, self.cover_cancel, complete)

    def send(self, message):
        if message.get("op") not in ("display-ping", "subscribe-display"):
            raise ValueError("展示端禁止发送播放控制命令")
        if self.ws and self.ws.get_state() == Soup.WebsocketState.OPEN:
            self.ws.send_text(json.dumps(message))

    def connect_host(self):
        self.retry_source = 0
        if self.closed:
            return False
        self.clock.offset, self.clock.best_rtt = None, math.inf
        parsed = urlsplit(HOST)
        url = ("wss" if parsed.scheme == "https" else "ws") + "://" + parsed.netloc + "/ws"
        message = Soup.Message.new("GET", url)
        def complete(session, result):
            try:
                ws = session.websocket_connect_finish(result)
            except GLib.Error:
                self.disconnected()
                return
            if self.closed:
                ws.close(1000, "exit")
                return
            # 长 TTML 快照可超过 Soup 默认上限，仍使用有界的消息预算。
            ws.set_max_incoming_payload_size(8 * 1024 * 1024)
            self.ws = ws
            self.retry = 0
            self.last_message = now_ms()
            ws.connect("message", self.message)
            ws.connect("closed", lambda *_: self.disconnected())
            ws.connect("error", lambda *_: ws.close(1001, "reconnect"))
            self.send({"op": "display-ping", "clientTime": now_ms()})
            self.send({"op": "subscribe-display", "visible": self.visible, "spectrum": True})
            self.heartbeat_source = GLib.timeout_add_seconds(10, self.heartbeat)
        self.session.websocket_connect_async(message, None, None, GLib.PRIORITY_DEFAULT, self.cancel, complete)
        return False

    def message(self, _ws, kind, payload):
        if kind == Soup.WebsocketDataType.BINARY:
            if self.connected and self.visible and self.clock.playing and self.spectrum.feed(payload.get_data(), now_ms()):
                self.last_message = now_ms()
                self.spectrum_frames += 1
                if not self.spectrum_source:
                    self.spectrum_source = GLib.timeout_add(16, self.spectrum_tick)
            return
        if kind != Soup.WebsocketDataType.TEXT:
            return
        self.last_message = now_ms()
        try:
            message = json.loads(payload.get_data())
            kind = message["kind"]
            data = message.get("data", {})
            if kind == "display-pong":
                self.clock.calibrate(message["clientTime"], now_ms(), message["serverTime"])
            elif kind == "display-snapshot":
                self.snapshot(data)
            elif kind == "display-position" and data["trackId"] == self.track_id:
                self.duration = data["duration"]
                self.snap |= self.clock.sync(data, now_ms())
                if not self.clock.playing:
                    self.clear_spectrum()
                self.start_ticks()
            elif kind == "display-offset" and data["trackId"] == self.track_id:
                self.offset, self.snap = data["offsetMs"], True
                self.start_ticks()
        except (ValueError, KeyError, TypeError) as error:
            print("显示消息无效:", error, flush=True)

    def heartbeat(self):
        if now_ms() - self.last_message > 25000:
            if self.ws:
                self.ws.close(1001, "timeout")
        else:
            self.send({"op": "display-ping", "clientTime": now_ms()})
        return True

    def disconnected(self):
        self.clear_spectrum()
        self.ws = None
        self.connected = False
        self.clock.freeze(now_ms())
        if self.heartbeat_source:
            GLib.source_remove(self.heartbeat_source)
            self.heartbeat_source = 0
        self.area.queue_draw()
        if not self.closed and not self.retry_source:
            self.retry_source = GLib.timeout_add(min(10000, 500 * 2 ** min(self.retry, 5)), self.connect_host)
            self.retry += 1

    def set_visible(self, visible):
        if self.visible == visible:
            return
        self.visible = visible
        self.send({"op": "subscribe-display", "visible": visible, "spectrum": True})
        if not visible:
            self.clear_spectrum()
        if visible:
            self.snap = True
            self.start_ticks()
        elif self.tick_id:
            self.area.remove_tick_callback(self.tick_id)
            self.tick_id = 0

    def visibility(self, _widget, event):
        self.set_visible(event.state != Gdk.VisibilityState.FULLY_OBSCURED)
        return False

    def window_state(self, _widget, event):
        if event.changed_mask & Gdk.WindowState.ICONIFIED:
            self.set_visible(not bool(event.new_window_state & Gdk.WindowState.ICONIFIED))
        return False

    def key(self, _widget, event):
        if event.keyval == Gdk.KEY_F11:
            self.full = not self.full
            self.fullscreen() if self.full else self.unfullscreen()
            return True
        if event.keyval == Gdk.KEY_Escape:
            self.full = False
            self.unfullscreen()
            return True
        if event.keyval in (Gdk.KEY_q, Gdk.KEY_Q) and event.state & Gdk.ModifierType.CONTROL_MASK:
            self.destroy()
            return True
        return False

    def load_bench(self):
        data = json.loads(Path(BENCH).read_text())
        data.update(position=BENCH_START, playing=True, speed=1, sendTimestamp=0)
        data.setdefault("track", {"id": "benchmark", "title": "固定时间段重放", "artists": []})
        self.snapshot(data)
        cover = os.environ.get("SURFACE_NATIVE_COVER")
        if cover:
            self.cover = GdkPixbuf.Pixbuf.new_from_file_at_scale(cover, 850, 850, True)
        return False

    def diagnostics(self):
        data = self.bench_result or {
            "done": False, "connected": self.connected, "trackId": self.track_id,
            "lyricCount": len(self.lines), "playing": self.clock.playing,
            "position": self.current(), "fps": round(self.fps, 1), "renderer": "Pango-Cairo",
            "readOnly": True, "visible": self.visible, "cacheMiB": self.cache_bytes / 1024 ** 2,
            "cachedLines": len(self.cache), "viewport": [self.width, self.height],
            "interlude": self.dot_gap,
            "backgroundMiB": (sum(s.get_width() * s.get_height() * 4 for s in
                                  [self.background_surface] + [edge for edge, _ in self.background_edges]) / 1024 ** 2
                              if self.background_surface else 0),
            "backgroundBuildMs": round(self.background_build_ms, 2),
            "spectrumFrames": self.spectrum_frames,
            "spectrumPeak": round(max(self.spectrum.levels), 3),
        }
        STATUS.parent.mkdir(parents=True, exist_ok=True)
        temporary = STATUS.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False))
        temporary.replace(STATUS)
        return True

    def shutdown(self, *_):
        self.closed = True
        self.cancel.cancel()
        if self.cover_cancel:
            self.cover_cancel.cancel()
        if self.ws:
            self.ws.close(1000, "exit")
        for source in (self.status_source, self.retry_source, self.heartbeat_source, self.spectrum_source):
            if source:
                GLib.source_remove(source)
        if self.tick_id:
            self.area.remove_tick_callback(self.tick_id)
        self.cache.clear()
        self.session.abort()


class Application(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="org.neclyon.SurfacePlayerNative")

    def do_activate(self):
        window = self.get_active_window() or Player(self)
        window.present()


if __name__ == "__main__":
    Application().run(None)
