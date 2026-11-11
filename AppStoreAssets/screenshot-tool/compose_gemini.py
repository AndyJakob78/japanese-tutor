"""Variant: Gemini (AI Studio, Nano Banana 2) artwork as the background, real app screen on top.
usage: python3 compose_gemini.py raw out
Backgrounds live in gemini/bg_<name>.jpg; GEMINI maps slide → (file, vertical shift in px, zoom)."""
import sys
from PIL import Image, ImageDraw, ImageFilter
import compose as C

KAIJU = {   # slide → (top of the kaiju relative to the phone top, height in px)
    # removed 2026-11-11 at the user's request (they only want Godzilla, which we can't use: Toho trademark)
}
POLE_X_SRC = 136   # x of the pole in gemini/kaiju.png (measured)

# slide → (background file, vertical shift in px after scaling to 1290 wide, mirror, rows to cut off the top
# of the original first). A positive shift leaves room at the top, filled with the artwork's own sky colour.
GEMINI = {
    '1_feed.png': ('gemini/bg_tokyo.jpg', 60, True, 0),
    '2_word.png': ('gemini/bg_fuji.jpg', -470, False, 0),
    '4_sentence.png': ('gemini/bg_pagoda.jpg', -140, False, 0),
    '3_listen.png': ('gemini/bg_festival.jpg', 300, False, 500),
    '5_quiz.png': ('gemini/bg_castle.jpg', 180, False, 0),
    '6_vocab.png': ('gemini/bg_wave.jpg', 100, False, 0),
}

# paint over small sign-like marks that look like real brands (original px, before mirroring)
RETOUCH = {
    'gemini/bg_tokyo.jpg': [(1040, 1255, 1160, 1335)],
}


def gemini_background(path, shift, mirror, crop_top=0):
    art = Image.open(path).convert('RGB')
    if crop_top:
        art = art.crop((0, crop_top, art.width, art.height))
    for box in RETOUCH.get(path, []):
        patch = art.crop((box[0] - (box[2] - box[0]), box[1], box[0], box[3]))   # copy the area to its left
        art.paste(patch, (box[0], box[1]))
    if mirror:
        art = art.transpose(Image.FLIP_LEFT_RIGHT)
    w = C.W
    art = art.resize((w, int(art.height * w / art.width)), Image.LANCZOS)
    bg = Image.new('RGB', (C.W, C.H), art.getpixel((art.width // 2, art.height - 5)))
    # below the artwork: its own bottom part mirrored and darkened, so there is no hard edge
    gap_top = shift + art.height
    if gap_top < C.H:
        strip = art.crop((0, art.height - (C.H - gap_top), w, art.height)).transpose(Image.FLIP_TOP_BOTTOM)
        strip = Image.blend(strip, Image.new('RGB', strip.size, (6, 12, 34)), 0.55)
        bg.paste(strip, ((C.W - w) // 2, gap_top))
    bg.paste(art, ((C.W - w) // 2, shift))
    if shift > 0:   # sky above the artwork: its top row colour, blended in
        top_col = art.resize((1, 1), Image.BOX, box=(0, 0, art.width, 12)).getpixel((0, 0))
        sky = Image.new('RGB', (C.W, shift + 60), top_col)
        mask = Image.linear_gradient('L').rotate(180).resize((C.W, shift + 60))
        mask = mask.point(lambda v: 255 if v > 60 else int(v * 255 / 60))
        bg.paste(sky, (0, 0), mask)
    bg = bg.convert('RGBA')
    # darken behind the caption so white text stays readable
    shade = Image.new('RGBA', (C.W, C.H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for y in range(0, 860):
        sd.line([(0, y), (C.W, y)], fill=(8, 14, 40, int(205 * (1 - y / 860) ** 1.1)))
    return Image.alpha_composite(bg, shade)


def compose_g(slide):
    fname, lines, sub, badge, box = slide
    seal_text, romaji, _ = C.JAPANESE[fname]
    img = gemini_background(*GEMINI[fname])
    hk = C.seal(seal_text, romaji)
    img.paste(hk, (C.W - hk.width - 30, 140), hk)
    y = 250
    if badge:
        d = ImageDraw.Draw(img)
        bf = C.font(44, 'Bold')
        tw = d.textlength(badge, font=bf)
        d.rounded_rectangle([C.LEFT, y - 70, C.LEFT + tw + 56, y - 4], 33, fill=C.SUN)
        d.text((C.LEFT + 28, y - 63), badge, font=bf, fill=(255, 255, 255))
        y += 16
    y = C.draw_headline(img, lines, y)
    d = ImageDraw.Draw(img)
    d.text((C.LEFT, y + 22), sub, font=C.font(50, 'Medium'), fill=(255, 255, 255, 230))
    horizon = int(y + 22 + 60 + 430)
    ph = C.phone(f'{C.RAW}/{fname}', box)
    px, py = (C.W - ph.width) // 2, horizon - 20
    if fname in KAIJU:   # make room on the right for the climber
        px = 40
    shadow = Image.new('RGBA', (C.W, C.H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([px + 10, py + 30, px + ph.width - 10, py + ph.height + 30], 150, fill=(0, 0, 0, 140))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(40)))
    img.paste(ph, (px, py), ph)
    if fname in KAIJU:
        dy, kh = KAIJU[fname]
        k = Image.open('gemini/kaiju.png')
        scale = kh / k.height
        k = k.resize((int(k.width * scale), kh), Image.LANCZOS)
        # the pole in the drawing goes on the phone's right frame, so the kaiju holds the phone
        kx = px + ph.width - 11 - int(POLE_X_SRC * scale)
        img.alpha_composite(k, (kx, py + dy))
    return img.convert('RGB')


if __name__ == '__main__':
    for n, s in enumerate(C.SLIDES, 1):
        if s[0] in GEMINI:
            out = f'{C.OUT}/{n:02d}_{s[0].split("_", 1)[1]}'
            compose_g(s).save(out, optimize=True)
            print(out)
