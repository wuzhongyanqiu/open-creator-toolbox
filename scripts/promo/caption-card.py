#!/usr/bin/env python3
"""Render a transparent caption PNG for ffmpeg overlay.

Homebrew's default ffmpeg ships without libfreetype/libass, so drawtext and
subtitles filters are unavailable. Render text with Pillow instead, then
overlay it with `overlay=...:enable='between(t,A,B)'`.

Usage:
  caption-card.py --text "这关我闭眼都能过" --out top.png --style meme
  caption-card.py --text "一笔拖线，三机连爆" --out sub.png --style subtitle --width 1080
  caption-card.py --text "?" --out q.png --style impact --font /path/OFL-font.ttf
"""
from argparse import ArgumentParser
from os import environ
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont

FALLBACK_FONTS = [
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
]

STYLES = {
    "meme": {"size": 0.085, "fill": (255, 255, 255, 255), "stroke": (0, 0, 0, 255), "stroke_w": 0.11, "box": None},
    "impact": {"size": 0.16, "fill": (255, 232, 64, 255), "stroke": (20, 0, 0, 255), "stroke_w": 0.12, "box": None},
    "subtitle": {"size": 0.052, "fill": (255, 255, 255, 255), "stroke": (0, 0, 0, 200), "stroke_w": 0.06, "box": (0, 0, 0, 150)},
    "title": {"size": 0.075, "fill": (245, 240, 255, 255), "stroke": (0, 0, 0, 160), "stroke_w": 0.05, "box": None},
}


def resolve_font(path: str | None) -> str:
    if path:
        return path
    if environ.get("PROMO_FONT"):
        return environ["PROMO_FONT"]
    for candidate in FALLBACK_FONTS:
        if Path(candidate).exists():
            print(f"warning: using system font {candidate}; pass --font with an OFL/commercial-cleared font before publishing", file=sys.stderr)
            return candidate
    raise SystemExit("no CJK font found; pass --font or set PROMO_FONT")


def wrap(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\\n"):
        line = ""
        for char in paragraph:
            if font.getlength(line + char) > max_width and line:
                lines.append(line)
                line = char
            else:
                line += char
        lines.append(line)
    return lines


def main() -> None:
    parser = ArgumentParser()
    parser.add_argument("--text", required=True, help="use \\n for manual line breaks")
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=int, default=1080, help="canvas width, match the video width")
    parser.add_argument("--style", choices=STYLES, default="meme")
    parser.add_argument("--font")
    parser.add_argument("--size", type=int, help="override font px size")
    parser.add_argument("--color", help="override fill, e.g. #ffe840")
    args = parser.parse_args()

    style = STYLES[args.style]
    size = args.size or round(args.width * style["size"])
    font = ImageFont.truetype(resolve_font(args.font), size)
    stroke_w = max(1, round(size * style["stroke_w"]))
    pad = round(size * 0.45)
    lines = wrap(args.text, font, args.width - pad * 2)
    line_h = round(size * 1.28)
    height = line_h * len(lines) + pad * 2

    image = Image.new("RGBA", (args.width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    fill = style["fill"]
    if args.color:
        value = args.color.lstrip("#")
        fill = tuple(int(value[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    if style["box"]:
        widest = max(font.getlength(line) for line in lines)
        left = (args.width - widest) / 2 - pad * 0.6
        draw.rounded_rectangle((left, pad * 0.4, args.width - left, height - pad * 0.4), radius=round(size * 0.3), fill=style["box"])
    for index, line in enumerate(lines):
        x = (args.width - font.getlength(line)) / 2
        y = pad + index * line_h
        draw.text((x, y), line, font=font, fill=fill, stroke_width=stroke_w, stroke_fill=style["stroke"])

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    image.save(args.out)
    print(f"{args.out} {args.width}x{height}")


if __name__ == "__main__":
    main()
