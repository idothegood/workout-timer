"""Draws the app icon (stopwatch ring + dumbbell on a dark tile) in every size the desktop app and web app need."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
S = 1024  # draw big, downscale for crisp edges


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def draw(full_bleed=False, scale=1.0):
    """full_bleed: square background edge to edge (iOS / Android maskable). scale: shrink the artwork into the safe zone."""
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    grad = Image.new('RGBA', (S, S))
    gd = ImageDraw.Draw(grad)
    top, bot = (32, 36, 48, 255), (12, 13, 18, 255)
    for y in range(S):
        gd.line([(0, y), (S, y)], fill=lerp(top, bot, y / S))
    if full_bleed:
        img = grad
    else:
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([40, 40, S - 40, S - 40], radius=220, fill=255)
        img.paste(grad, (0, 0), mask)

    k = lambda v: int(v * scale)  # noqa: E731
    cx, cy, r = S // 2, S // 2 + k(30), k(320)
    d = ImageDraw.Draw(img)

    # stopwatch crown + stem
    d.rounded_rectangle([cx - k(60), cy - r - k(120), cx + k(60), cy - r - k(50)], radius=k(20), fill=(230, 232, 240, 255))
    d.rectangle([cx - k(24), cy - r - k(60), cx + k(24), cy - r + k(10)], fill=(230, 232, 240, 255))

    # progress ring: dim track + glowing green arc (about 3/4)
    w = k(54)
    box = [cx - r, cy - r, cx + r, cy + r]
    d.ellipse(box, outline=(55, 60, 75, 255), width=w)
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).arc(box, start=-90, end=180, fill=(74, 222, 128, 255), width=w + k(30))
    glow = glow.filter(ImageFilter.GaussianBlur(k(28)))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)
    for i in range(60):  # green -> teal gradient along the arc
        a0 = -90 + i * 4.5
        d.arc(box, start=a0, end=a0 + 5, fill=lerp((74, 222, 128, 255), (45, 212, 191, 255), i / 59), width=w)

    # dumbbell in the middle
    white = (240, 242, 248, 255)
    bar_h = k(34)
    d.rounded_rectangle([cx - k(190), cy - bar_h // 2, cx + k(190), cy + bar_h // 2], radius=k(14), fill=white)
    for sx in (-1, 1):
        x1 = cx + sx * k(120)
        a, b = sorted([x1, x1 + sx * k(52)])
        d.rounded_rectangle([a, cy - k(130), b, cy + k(130)], radius=k(22), fill=white)
        x2 = x1 + sx * k(62)
        a, b = sorted([x2, x2 + sx * k(40)])
        d.rounded_rectangle([a, cy - k(90), b, cy + k(90)], radius=k(18), fill=white)
    return img


def make():
    icon = draw()
    icon.save(HERE / 'icon.png')
    icon.resize((256, 256), Image.LANCZOS).save(HERE / 'icon-256.png')  # shown in the app's menu
    icon.resize((256, 256), Image.LANCZOS).save(
        HERE / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    # web app
    web = HERE / 'web-icons'
    web.mkdir(exist_ok=True)
    icon.resize((192, 192), Image.LANCZOS).save(web / 'icon-192.png')
    icon.resize((512, 512), Image.LANCZOS).save(web / 'icon-512.png')
    icon.resize((64, 64), Image.LANCZOS).save(web / 'favicon.png')
    draw(full_bleed=True, scale=0.78).resize((512, 512), Image.LANCZOS).save(web / 'icon-maskable-512.png')
    draw(full_bleed=True, scale=0.9).convert('RGB').resize((180, 180), Image.LANCZOS).save(web / 'apple-touch-icon.png')


if __name__ == '__main__':
    make()
