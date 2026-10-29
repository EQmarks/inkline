#!/usr/bin/env python3
"""生成抄写台的 PWA 图标（运行：python tools/make_icons.py）"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)

TOP = (0x4F, 0x91, 0x5F)     # 绿
BOTTOM = (0x2F, 0x6A, 0x3E)
YELLOW = (0xF5, 0xCF, 0x5B)  # 当前句黄
WHITE = (0xF7, 0xFB, 0xF5)
SCALE = 2


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


def bar(draw, x, y, w, h, color):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=h / 2, fill=color)


def render(size, full_bleed=False, content_scale=1.0):
    s = size * SCALE
    img = gradient(s).convert("RGBA")
    img.putalpha(rounded_mask(s, int(s * 0.226), full_bleed))

    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    u = s / 512.0 * content_scale
    off = (s - 512 * u) / 2.0

    def X(v):
        return off + v * u

    def Y(v):
        return off + v * u

    bar(draw, X(104), Y(160), 304 * u, 30 * u, WHITE + (140,))
    bar(draw, X(104), Y(241), 232 * u, 30 * u, YELLOW + (255,))
    bar(draw, X(104), Y(322), 272 * u, 30 * u, WHITE + (230,))

    img = Image.alpha_composite(img, layer)
    return img.resize((size, size), Image.LANCZOS)


render(512).save(OUT / "icon-512.png")
render(192).save(OUT / "icon-192.png")
render(180, full_bleed=True).save(OUT / "apple-touch-icon.png")
render(512, full_bleed=True, content_scale=0.72).save(OUT / "icon-maskable-512.png")
render(32).save(OUT / "favicon-32.png")
print("icons written to", OUT)
