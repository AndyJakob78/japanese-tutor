"""App Store creative assets (iOS 27 product page): header 21:9 and search results 3:2.
Specs (developer.apple.com, creative-assets-specifications): header 3840x1646 jpg/png,
search results 3:2 1920x1280 .. 3840x2560; no alpha channel.
usage (from AppStoreAssets/screenshot-tool): python3 compose_creative.py → ../creative-1.4/
Art: gemini/bg_header_21x9.jpg and gemini/bg_search_3x2.jpg (Nano Banana 2, AI Studio).
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

sys.argv = [sys.argv[0], 'raw', '/tmp']   # compose.py reads these at import
import compose as C   # fonts, seal, colours, phone frame

OUT = os.path.join('..', 'creative-1.4')
os.makedirs(OUT, exist_ok=True)


def cover(path, w, h, focus_y=0.5):
    art = Image.open(path).convert('RGB')
    s = max(w / art.width, h / art.height)
    art = art.resize((round(art.width * s), round(art.height * s)), Image.LANCZOS)
    x = (art.width - w) // 2
    y = int((art.height - h) * focus_y)
    return art.crop((x, y, x + w, y + h))


def shade(img, box, alpha=150, blur=120):
    """Soft dark pool behind text so it stays readable on any art."""
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(box, 200, fill=(6, 10, 32, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(img.convert('RGBA'), layer)


def text_lines(d, lines, x, y, size, center=None, gap=1.16):
    f = C.font(size, 'Bold')
    for line in lines:
        parts = line.split('*')
        tw = sum(d.textlength(p, font=f) for p in parts)
        cx = (center - tw / 2) if center is not None else x
        for i, p in enumerate(parts):
            d.text((cx, y), p, font=f, fill=C.ACCENT if i % 2 else (255, 255, 255))
            cx += d.textlength(p, font=f)
        y += int(size * gap)
    return y


# ---------- header 3840x1646: art + one short phrase in the centre safe area ----------
W, H = 3840, 1646
img = cover('gemini/bg_header_21x9.jpg', W, H, focus_y=0.55)
# text in the calm sky, narrow enough for the centre crop an iPhone shows
img = shade(img, (W * 0.33, H * 0.02, W * 0.67, H * 0.42), alpha=110)
d = ImageDraw.Draw(img)
y = text_lines(d, ['Learn Japanese', "from *today's news*"], 0, int(H * 0.07), 140, center=W / 2)
sf = C.font(64, 'Medium')
sub = 'Read  ·  Listen  ·  Write  ·  Remember'
d.text(((W - d.textlength(sub, font=sf)) / 2, y + 16), sub, font=sf, fill=(255, 255, 255))
# PNG: App Store Connect rejected the same image as JPEG ("File dimensions are invalid")
img.convert('RGB').save(os.path.join(OUT, 'header_3840x1646.png'), optimize=True)

# ---------- search results 3840x2560: purpose at a glance + the real app ----------
W, H = 3840, 2560
img = cover('gemini/bg_search_3x2.jpg', W, H, focus_y=0.5)
img = shade(img, (-400, H * 0.18, W * 0.50, H * 0.86), alpha=170)
d = ImageDraw.Draw(img)
hk = C.seal('新聞', 'shinbun')
hk = hk.resize((int(hk.width * 1.6), int(hk.height * 1.6)), Image.LANCZOS)
img.paste(hk, (240, int(H * 0.22)), hk)
y = text_lines(d, ['Learn Japanese', "from *today's news*"], 240, int(H * 0.22) + hk.height + 60, 200)
sf = C.font(92, 'Medium')
for s in ['Real articles at your JLPT level', 'Tap any word · Hear every sentence']:
    d.text((240, y + 30), s, font=sf, fill=(255, 255, 255))
    y += 120
# two real screens, slightly overlapping, on the right
for fname, box, cx, scale, rot in [
    ('2_word.png', (40, 1410, 1166, 1606), 2560, 0.92, 0),
    ('3_listen.png', (14, 352, 1192, 668), 3300, 0.92, 0),
]:
    ph = C.phone(os.path.join('raw', fname), box)
    ph = ph.resize((int(ph.width * scale), int(ph.height * scale)), Image.LANCZOS)
    top = int(H * 0.09)
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([cx - ph.width // 2 + 20, top + 40, cx + ph.width // 2 - 20, top + ph.height + 40],
                                         140, fill=(0, 0, 0, 130))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(50)))
    img.paste(ph, (cx - ph.width // 2, top), ph)
img.convert('RGB').save(os.path.join(OUT, 'search_3840x2560.jpg'), quality=93)
print('done')
