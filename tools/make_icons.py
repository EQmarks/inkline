#!/usr/bin/env python3
"""生成抄写台的 PWA 图标（运行：python tools/make_icons.py）"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)

TOP = (0xD4, 0x55, 0x3B)
BOTTOM = (0xA9, 0x35, 0x22)
SCALE = 2  # 先画大图再缩小，边缘更干净


def rounded_mask(size, radius, full_bleed):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    if full_bleed:
        draw.rectangle([0, 0, size, size], fill=255)
    else:
        draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def gradient(size):
    grad = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / max(1, size - 1)
        color = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (size, y)], fill=color)
    return grad


def bar(draw, x, y, w, h, alpha):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=h / 2, fill=(255, 255, 255, alpha))


def render(size, full_bleed=False, content_scale=1.0):
    s = size * SCALE
    img = gradient(s).convert("RGBA")
    img.putalpha(rounded_mask(s, int(s * 0.226), full_bleed))

    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    u = s / 512.0 * content_scale
    off = (s - 512 * u) / 2.0
    def X(v): return off + v * u
    def Y(v): return off + v * u

    draw.rounded_rectangle([X(72), Y(222), X(440), Y(290)], radius=34 * u, fill=(255, 255, 255, 36))
    bar(draw, X(104), Y(160), 304 * u, 30 * u, 184)
    bar(draw, X(104), Y(241), 232 * u, 30 * u, 255)
    bar(draw, X(104), Y(322), 272 * u, 30 * u, 184)

    img = Image.alpha_composite(img, layer)
    return img.resize((size, size), Image.LANCZOS)


render(512).save(OUT / "icon-512.png")
render(192).save(OUT / "icon-192.png")
render(180, full_bleed=True).save(OUT / "apple-touch-icon.png")
render(512, full_bleed=True, content_scale=0.72).save(OUT / "icon-maskable-512.png")
render(32).save(ROOT / "favicon-32.png")
print("icons written to", OUT)
