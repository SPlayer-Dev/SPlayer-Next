"""离线验证两种罗马音来源与 Ruby 共存时的实际 Pango/Cairo 排版。"""
from collections import OrderedDict
from copy import deepcopy
from pathlib import Path
import sys
import unittest

import player
from gi.repository import Gtk
import cairo


class Canvas:
    text_layout = player.Player.text_layout
    row_layout = player.Player.row_layout
    rectangles = staticmethod(player.Player.rectangles)
    raster = player.Player.raster

    def __init__(self):
        self.area = Gtk.DrawingArea()
        self.font_size = 48
        self.lyric_width = 700
        self.cache = OrderedDict()
        self.cache_bytes = self.cache_peak = 0
        self.lines = []


def line():
    return dict(startTime=0, endTime=2000, translatedLyric="仰望天空", words=[
        dict(word="空", romanWord="sora", startTime=0, endTime=1000,
             ruby=[dict(word="そら", startTime=0, endTime=1000)]),
        dict(word="を見る", romanWord="o miru", startTime=1000, endTime=2000),
    ])


class AnnotationTests(unittest.TestCase):
    def setUp(self):
        self.canvas = Canvas()

    def test_line_and_word_romanization_have_identical_placement(self):
        words = line()
        full = deepcopy(words)
        full["romanLyric"] = "sora o miru"
        for word in full["words"]:
            word.pop("romanWord")
        self.canvas.lines = [words, full]
        for item in (words, full):
            layout = self.canvas.row_layout(item)
            self.assertEqual(layout[1].get_text(), "sora o miru\n仰望天空")
            self.assertGreater(layout[3], layout[2] + layout[0].get_pixel_size()[1])
        a = self.canvas.raster(0)[0]
        b = self.canvas.raster(1)[0]
        self.assertEqual(bytes(a.get_data()), bytes(b.get_data()))

    def test_ruby_never_removes_romanization(self):
        both = line()
        roman = deepcopy(both)
        roman["words"][0].pop("ruby")
        with_ruby = self.canvas.row_layout(both)
        without_ruby = self.canvas.row_layout(roman)
        self.assertEqual(with_ruby[1].get_text(), without_ruby[1].get_text())
        self.assertGreater(with_ruby[2], 0)
        self.assertEqual(without_ruby[2], 0)
        self.canvas.lines = [both]
        surface = self.canvas.raster(0)[0]
        surface.flush()
        self.assertTrue(any(bytes(surface.get_data())[:int(with_ruby[2]) * surface.get_stride()]))

    def test_complete_line_wins_over_partial_word_data(self):
        item = line()
        item["romanLyric"] = "sora o miru"
        item["words"][1].pop("romanWord")
        self.assertEqual(self.canvas.row_layout(item)[1].get_text(), "sora o miru\n仰望天空")

    def test_missing_romanization_does_not_duplicate_ruby(self):
        item = line()
        for word in item["words"]:
            word.pop("romanWord")
        self.assertEqual(self.canvas.row_layout(item)[1].get_text(), "仰望天空")
        item["translatedLyric"] = ""
        self.assertIsNone(self.canvas.row_layout(item)[1])

    def test_wrapping_duet_and_cache_reuse(self):
        item = line()
        item.update(isDuet=True, romanLyric="sora o miru " * 25)
        self.canvas.lines = [item]
        layout = self.canvas.row_layout(item)
        self.assertGreater(layout[1].get_line_count(), 2)
        self.assertGreater(layout[4], layout[3] + layout[1].get_pixel_size()[1])
        surface, _, size = self.canvas.raster(0)
        self.assertIs(self.canvas.raster(0)[0], surface)
        self.assertEqual(self.canvas.cache_bytes, size)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--preview":
        canvas = Canvas()
        canvas.lines = [line()]
        mask = canvas.raster(0)[0]
        image = cairo.ImageSurface(cairo.FORMAT_ARGB32, mask.get_width(), mask.get_height())
        ctx = cairo.Context(image)
        ctx.set_source_rgb(*player.BG)
        ctx.paint()
        ctx.set_source_rgb(1, 1, 1)
        ctx.mask_surface(mask, 0, 0)
        image.write_to_png(str(Path(sys.argv[2])))
    else:
        unittest.main()
