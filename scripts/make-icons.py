"""生成 PWA 图标：米色底 + 手绘感笑脸，比例与 public/icon.svg 保持一致。"""

from pathlib import Path

from PIL import Image, ImageDraw

BG = (244, 241, 234)
INK = (33, 30, 26)
SIZE = 1024
OUT = Path(r"D:\Desktop\dsh工作区\mood-journal\public\icons")


def draw_icon(size: int) -> Image.Image:
    scale = size / 512
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)

    def s(value: float) -> float:
        return value * scale

    stroke = max(1, round(21 * scale))

    # 眼睛：浅弧，像手写的 ^ ^
    draw.arc([s(152), s(178), s(204), s(238)], start=200, end=340, fill=INK, width=stroke)
    draw.arc([s(308), s(178), s(360), s(238)], start=200, end=340, fill=INK, width=stroke)
    # 嘴：一条下弯的弧
    draw.arc([s(156), s(268), s(356), s(392)], start=20, end=160, fill=INK, width=stroke)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    base = draw_icon(SIZE)
    for target in (180, 192, 512):
        base.resize((target, target), Image.LANCZOS).save(OUT / f"icon-{target}.png", optimize=True)
    print("wrote", [f"icon-{t}.png" for t in (180, 192, 512)])


if __name__ == "__main__":
    main()
