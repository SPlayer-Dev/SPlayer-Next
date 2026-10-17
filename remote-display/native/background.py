"""低分辨率生成封面模糊背景，只保留当前窗口的一张不透明缓存。"""
import math

import cairo
from PIL import Image, ImageEnhance, ImageFilter, ImageOps


def build_background(cover, width, height, scale):
    # 对应原版的 cover、1.5 倍放大、45px 模糊、1.2 倍饱和度和半透明黑色。
    factor = min(1, 320 / max(cover.get_width(), cover.get_height()))
    small = cover.scale_simple(max(1, round(cover.get_width() * factor)),
                               max(1, round(cover.get_height() * factor)), 2)
    mode = "RGBA" if small.get_has_alpha() else "RGB"
    image = Image.frombytes(mode, (small.get_width(), small.get_height()), small.get_pixels(),
                            "raw", mode, small.get_rowstride()).convert("RGB")
    ratio = min(1, 320 / max(width, height))
    w, h = max(1, round(width * ratio)), max(1, round(height * ratio))
    image = ImageOps.fit(image, (w, h), method=Image.Resampling.BILINEAR)
    image = image.crop((w / 6, h / 6, w * 5 / 6, h * 5 / 6)).resize((w, h), Image.Resampling.BILINEAR)
    image = image.filter(ImageFilter.GaussianBlur(45 * ratio))
    image = ImageEnhance.Color(image).enhance(1.2)
    image = ImageEnhance.Brightness(image).enhance(.5)
    pixels = bytearray(image.tobytes("raw", "BGRX"))
    thumbnail = cairo.ImageSurface.create_for_data(pixels, cairo.FORMAT_RGB24, w, h)
    surface = cairo.ImageSurface(cairo.FORMAT_RGB24, math.ceil(width * scale), math.ceil(height * scale))
    surface.set_device_scale(scale, scale)
    ctx = cairo.Context(surface)
    ctx.scale(width / w, height / h)
    ctx.set_source_surface(thumbnail)
    ctx.get_source().set_filter(cairo.FILTER_BILINEAR)
    ctx.get_source().set_extend(cairo.EXTEND_PAD)
    ctx.paint()
    return surface
