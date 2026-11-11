"""Compose App Store screenshots: gradient background, caption, real screen in a phone frame.
Output: 1290x2796 PNG (accepted for the 6.9"/6.7" iPhone slot)."""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1290, 2796
FONT = '/System/Library/Fonts/SFNS.ttf'
MINCHO = '/System/Library/Fonts/ヒラギノ明朝 ProN.ttc'   # index 1 = W6 (bold)
import glob, math, random
_toppan = glob.glob('/System/Library/AssetsV2/*/*/AssetData/ToppanBunkyuMidashiMinchoStdN-ExtraBold.otf')
SEAL_FONT = _toppan[0] if _toppan else MINCHO
RAW = sys.argv[1]
OUT = sys.argv[2]


def font(size, weight):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_name(weight)
    return f


SLIDES = [
    # file, headline lines (word in *stars* is highlighted), subline, badge
    # file, headline lines (*word* = highlighted), subline, badge, outline box in raw screenshot px
    # (seal kanji, romaji, background kanji) per slide are in JAPANESE below
    ('1_feed.png', ['Learn Japanese', 'from *today\'s news*'], 'Fresh articles at your level, every day', None, None),
    ('2_word.png', ['Tap *any word*', 'you don\'t know'], 'Its meaning in this sentence, instantly', None, (40, 1410, 1166, 1606)),
    ('4_sentence.png', ['Write it.', 'Get it *corrected*.'], 'Instant feedback on your own sentences', None, None),
    ('3_listen.png', ['Hear *every*', '*sentence*'], 'Natural Japanese voice, at your speed', 'NEW', (14, 352, 1192, 668)),
    ('5_quiz.png', ['Quizzes on what', 'you *just read*'], '7 questions after every article', None, None),
    ('6_vocab.png', ['Every word', 'you learn, *tracked*'], 'Daily review brings back what you forget', None, None),
]

JAPANESE = {
    '1_feed.png': ('新聞', 'shinbun', '読'),
    '2_word.png': ('単語', 'tango', '語'),
    '4_sentence.png': ('作文', 'sakubun', '書'),
    '3_listen.png': ('音読', 'ondoku', '聞'),
    '5_quiz.png': ('試験', 'shiken', '問'),
    '6_vocab.png': ('復習', 'fukushū', '覚'),
}

TOP = (30, 50, 104)      # ai-iro (indigo), lighter at the top
BOTTOM = (12, 22, 56)    # deep indigo
ACCENT = (233, 196, 106)  # kin (gold)
SUN = (196, 30, 46)       # shu (vermilion), seal red


def seigaiha(size, r=96, alpha=20):
    """Classic wave pattern (overlapping concentric half circles), white, very faint."""
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rows = int(size[1] / (r / 2)) + 3
    for row in range(rows):
        cy = row * r / 2
        offset = 0 if row % 2 == 0 else r
        for col in range(-1, int(size[0] / (2 * r)) + 2):
            cx = col * 2 * r + offset
            for k, rr in enumerate((r, r * 0.74, r * 0.48, r * 0.22)):
                d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(TOP if k % 2 else BOTTOM) + (0,),
                          outline=(255, 255, 255, alpha), width=3)
    return layer


def background(bg_kanji):
    bg = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(bg)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)))
    bg = bg.convert('RGBA')
    # wave pattern, fading in from the middle down (behind the phone)
    bg = Image.alpha_composite(bg, seigaiha((W, H), r=90, alpha=17))
    # one big faint kanji behind the headline
    kf = ImageFont.truetype(MINCHO, 760, index=1)
    kl = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    # (the big background kanji was dropped once Fuji/torii/sakura came in — too busy)
    return Image.alpha_composite(bg, kl)


def seal(text, romaji):
    """Red hanko stamp with two kanji stacked, slightly rotated, worn edges."""
    size = 220
    st = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(st)
    d.rounded_rectangle([6, 6, size - 6, size - 6], 22, fill=SUN + (255,))
    d.rounded_rectangle([18, 18, size - 18, size - 18], 14, outline=(255, 240, 235, 255), width=4)
    f = ImageFont.truetype(SEAL_FONT, 82)
    for i, ch in enumerate(text):
        w = d.textlength(ch, font=f)
        d.text(((size - w) / 2, 24 + i * 84), ch, font=f, fill=(255, 245, 240, 255))
    # worn ink: knock out random specks
    rnd = random.Random(text)
    a = st.getchannel('A')
    ad = ImageDraw.Draw(a)
    for _ in range(70):
        x, y = rnd.randint(0, size), rnd.randint(0, size)
        r = rnd.choice((1, 1, 2))
        ad.ellipse([x - r, y - r, x + r, y + r], fill=rnd.randint(150, 215))
    st.putalpha(a)
    st = st.rotate(-7, resample=Image.BICUBIC, expand=True)
    # romaji under the seal
    out = Image.new('RGBA', (st.width + 40, st.height + 70), (0, 0, 0, 0))
    out.paste(st, (20, 0), st)
    od = ImageDraw.Draw(out)
    rf = font(38, 'Semibold')
    od.text(((out.width - od.textlength(romaji, font=rf)) / 2, st.height + 6), romaji, font=rf, fill=ACCENT + (255,))
    return out


LEFT = 84


SAKURA = (247, 183, 200)
SAKURA_DARK = (226, 120, 150)


def blossom(d, cx, cy, r, rot, alpha=255, center=True):
    """Five-petal cherry blossom."""
    for k in range(5):
        a = math.radians(rot + k * 72)
        px, py = cx + math.cos(a) * r * 0.55, cy + math.sin(a) * r * 0.55
        pr = r * 0.52
        d.ellipse([px - pr, py - pr, px + pr, py + pr], fill=SAKURA + (alpha,))
    if center:
        d.ellipse([cx - r * 0.22, cy - r * 0.22, cx + r * 0.22, cy + r * 0.22], fill=SAKURA_DARK + (alpha,))


def petals(img, seed):
    """Petals drifting across the background."""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rnd = random.Random(seed)
    for _ in range(34):
        x, y = rnd.randint(0, W), rnd.randint(0, H)
        r = rnd.randint(9, 17)
        if 40 < x < 1000 and 200 < y < 640:   # keep the caption readable
            continue
        a = rnd.uniform(0, math.pi)
        # a single petal: rotated ellipse
        pet = Image.new('RGBA', (r * 4, r * 4), (0, 0, 0, 0))
        ImageDraw.Draw(pet).ellipse([r, r * 1.4, r * 3, r * 2.6], fill=SAKURA + (rnd.randint(205, 245),))
        pet = pet.rotate(math.degrees(a), resample=Image.BICUBIC)
        layer.paste(pet, (x, y), pet)
    return Image.alpha_composite(img, layer)


def sakura_branch(img):
    """Cherry branch reaching in from the top-left corner."""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    bark = (58, 36, 40, 255)
    main = [(-30, 30), (120, 70), (260, 92), (400, 98), (540, 86), (640, 70)]
    d.line(main, fill=bark, width=16, joint='curve')
    for a, b in [((150, 76), (210, 150)), ((330, 96), (380, 40)), ((470, 92), (530, 150))]:
        d.line([a, b], fill=bark, width=8)
    rnd = random.Random(7)
    spots = [(80, 50), (175, 120), (215, 160), (260, 70), (300, 120), (370, 45), (400, 120), (450, 70),
             (520, 140), (560, 60), (610, 95), (640, 58), (130, 105), (340, 70), (490, 110)]
    for (x, y) in spots:
        blossom(d, x, y, rnd.randint(26, 38), rnd.randint(0, 72))
    for (x, y) in [(235, 40), (430, 150), (590, 130)]:   # buds
        d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=SAKURA_DARK + (255,))
    return Image.alpha_composite(img, layer)


def scene(img, horizon):
    """Mount Fuji with a snowcap and a torii gate standing on the horizon."""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, peak, half = 800, horizon - 300, 560
    # mountain body (concave slopes)
    pts = [(cx - half, horizon)]
    for i in range(1, 20):
        t = i / 20
        pts.append((cx - half + (half - 45) * t, horizon - 300 * (t ** 1.7)))
    pts += [(cx - 45, peak), (cx + 45, peak)]
    for i in range(19, 0, -1):
        t = i / 20
        pts.append((cx + half - (half - 45) * t, horizon - 300 * (t ** 1.7)))
    pts.append((cx + half, horizon))
    d.polygon(pts, fill=(70, 98, 160, 255))
    # snowcap with a jagged lower edge
    snow_y = peak + 95
    def x_at(y, side):
        t = ((horizon - y) / 300) ** (1 / 1.7)
        return cx + side * (half - (half - 45) * t)
    cap = [(x_at(snow_y, -1), snow_y), (cx - 45, peak), (cx + 45, peak), (x_at(snow_y, 1), snow_y)]
    jag = []
    xl, xr = x_at(snow_y, -1), x_at(snow_y, 1)
    for k in range(7, 0, -1):
        x = xl + (xr - xl) * k / 8
        jag.append((x, snow_y + (28 if k % 2 else -6)))
    d.polygon(cap[:1] + cap[1:3] + cap[3:] + jag, fill=(246, 248, 252, 255))
    # torii (vermilion), left, standing on the horizon
    tx, tw, th = 70, 230, 250
    red = SUN + (255,)
    top = horizon - th
    d.polygon([(tx - 26, top + 6), (tx + tw + 26, top + 6), (tx + tw + 10, top + 30), (tx - 10, top + 30)], fill=red)  # kasagi
    d.rectangle([tx - 4, top + 30, tx + tw + 4, top + 40], fill=(30, 20, 24, 255))
    d.rectangle([tx + 6, top + 74, tx + tw - 6, top + 92], fill=red)          # nuki
    d.rectangle([tx + tw / 2 - 8, top + 40, tx + tw / 2 + 8, top + 74], fill=red)  # gakuzuka
    for x in (tx + 28, tx + tw - 50):
        d.rectangle([x, top + 40, x + 22, horizon], fill=red)                 # pillars
    # mist along the horizon
    mist = Image.new('RGBA', (W, 160), (0, 0, 0, 0))
    md = ImageDraw.Draw(mist)
    for i in range(160):
        md.line([(0, i), (W, i)], fill=(200, 215, 240, int(70 * (1 - abs(i - 80) / 80))))
    layer.paste(mist, (0, horizon - 90), mist)
    return Image.alpha_composite(img, layer)



# ---------------------------------------------------------------------------
# One scene per slide (all original drawings, flat style, on the horizon line)
# ---------------------------------------------------------------------------
INK = (24, 30, 58, 255)


def _mist(layer, horizon):
    mist = Image.new('RGBA', (W, 160), (0, 0, 0, 0))
    md = ImageDraw.Draw(mist)
    for i in range(160):
        md.line([(0, i), (W, i)], fill=(200, 215, 240, int(70 * (1 - abs(i - 80) / 80))))
    layer.paste(mist, (0, horizon - 90), mist)


def scene_tokyo(img, horizon):
    """Tokyo at dusk: skyline with lit windows and a red lattice tower."""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rnd = random.Random(3)
    # back row (lighter), front row (darker)
    for shade, base_h, n in (((62, 86, 146, 255), 210, 15), ((40, 58, 112, 255), 140, 12)):
        x = -20
        while x < W:
            bw = rnd.randint(60, 120)
            bh = base_h + rnd.randint(-70, 90)
            d.rectangle([x, horizon - bh, x + bw, horizon], fill=shade)
            for wy in range(horizon - bh + 16, horizon - 10, 26):
                for wx in range(x + 10, x + bw - 12, 22):
                    if rnd.random() < 0.35:
                        d.rectangle([wx, wy, wx + 8, wy + 12], fill=(255, 214, 120, 230))
            x += bw + rnd.randint(4, 14)
    # lattice tower (red and white bands), right of centre
    tx, top = 1110, horizon - 300
    red, white = SUN + (255,), (245, 245, 250, 255)
    legs = [(tx - 95, horizon), (tx - 12, top + 40), (tx + 12, top + 40), (tx + 95, horizon)]
    d.polygon(legs, fill=red)
    for k, yy in enumerate(range(top + 60, horizon, 46)):
        t = (yy - top) / (horizon - top)
        half = 12 + 83 * t
        d.line([(tx - half, yy), (tx + half, yy)], fill=white if k % 2 else red, width=8)
        d.line([(tx - half, yy), (tx + half - 10, yy + 40)], fill=(150, 20, 34, 255), width=3)
        d.line([(tx + half, yy), (tx - half + 10, yy + 40)], fill=(150, 20, 34, 255), width=3)
    for yy, w in ((top + 100, 40), (top + 190, 60)):       # observation decks
        d.rectangle([tx - w, yy, tx + w, yy + 22], fill=white)
    d.rectangle([tx - 4, top - 40, tx + 4, top + 44], fill=white)  # antenna
    d.rectangle([tx - 3, top - 40, tx + 3, top - 18], fill=red)
    _mist(layer, horizon)
    return Image.alpha_composite(img, layer)


def scene_fuji(img, horizon, torii=True, cx=800, height=300, half=560):
    """Mount Fuji with a snowcap (+ torii gate)."""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    peak = horizon - height
    pts = [(cx - half, horizon)]
    for i in range(1, 20):
        t = i / 20
        pts.append((cx - half + (half - 45) * t, horizon - height * (t ** 1.7)))
    pts += [(cx - 45, peak), (cx + 45, peak)]
    for i in range(19, 0, -1):
        t = i / 20
        pts.append((cx + half - (half - 45) * t, horizon - height * (t ** 1.7)))
    pts.append((cx + half, horizon))
    d.polygon(pts, fill=(70, 98, 160, 255))
    snow_y = peak + height * 0.32
    def x_at(y, side):
        t = ((horizon - y) / height) ** (1 / 1.7)
        return cx + side * (half - (half - 45) * t)
    xl, xr = x_at(snow_y, -1), x_at(snow_y, 1)
    jag = [(xl + (xr - xl) * k / 8, snow_y + (28 if k % 2 else -6)) for k in range(7, 0, -1)]
    d.polygon([(xl, snow_y), (cx - 45, peak), (cx + 45, peak), (xr, snow_y)] + jag, fill=(246, 248, 252, 255))
    if torii:
        tx, tw, th = 70, 230, 250
        red = SUN + (255,)
        top = horizon - th
        d.polygon([(tx - 26, top + 6), (tx + tw + 26, top + 6), (tx + tw + 10, top + 30), (tx - 10, top + 30)], fill=red)
        d.rectangle([tx - 4, top + 30, tx + tw + 4, top + 40], fill=(30, 20, 24, 255))
        d.rectangle([tx + 6, top + 74, tx + tw - 6, top + 92], fill=red)
        d.rectangle([tx + tw / 2 - 8, top + 40, tx + tw / 2 + 8, top + 74], fill=red)
        for x in (tx + 28, tx + tw - 50):
            d.rectangle([x, top + 40, x + 22, horizon], fill=red)
    _mist(layer, horizon)
    return Image.alpha_composite(img, layer)


def scene_pagoda(img, horizon):
    """Five-story pagoda on the right, a blooming cherry tree on the left."""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([-200, horizon - 90, 1500, horizon + 200], fill=(46, 66, 120, 255))   # hill
    px, roof_w, y = 1110, 220, horizon - 40
    wall = (150, 40, 44, 255)
    for k in range(5):
        h = 34
        w = roof_w - k * 30
        d.rectangle([px - w * 0.32, y - h, px + w * 0.32, y], fill=wall)
        # roof with upturned eaves
        d.polygon([(px - w / 2 - 18, y - h + 4), (px - w * 0.36, y - h - 22), (px + w * 0.36, y - h - 22),
                   (px + w / 2 + 18, y - h + 4), (px + w * 0.4, y - h - 4), (px - w * 0.4, y - h - 4)], fill=INK)
        y -= h + 14
    d.rectangle([px - 4, y - 50, px + 4, y + 4], fill=(212, 175, 80, 255))  # sorin spire
    for r in range(4):
        d.ellipse([px - 11, y - 46 + r * 11, px + 11, y - 40 + r * 11], fill=(212, 175, 80, 255))
    # cherry tree
    d.line([(230, horizon), (240, horizon - 110), (200, horizon - 190)], fill=(58, 36, 40, 255), width=26)
    d.line([(240, horizon - 120), (320, horizon - 200)], fill=(58, 36, 40, 255), width=16)
    rnd = random.Random(11)
    for _ in range(46):
        cx = rnd.randint(90, 400)
        cy = rnd.randint(horizon - 290, horizon - 130)
        if ((cx - 245) / 165) ** 2 + ((cy - (horizon - 210)) / 80) ** 2 > 1:
            continue
        blossom(d, cx, cy, rnd.randint(22, 34), rnd.randint(0, 72))
    _mist(layer, horizon)
    return Image.alpha_composite(img, layer)


def scene_festival(img, horizon):
    """Summer festival night: full moon, string of red paper lanterns, rooftops."""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([920, horizon - 400, 1180, horizon - 140], fill=(255, 236, 190, 120))
    layer = Image.alpha_composite(layer, glow.filter(ImageFilter.GaussianBlur(30)))
    d = ImageDraw.Draw(layer)
    d.ellipse([950, horizon - 370, 1150, horizon - 170], fill=(255, 240, 205, 255))  # moon
    # rooftops (tiled roofs with curved ends)
    for x0, w, h in ((-40, 360, 120), (300, 300, 90), (560, 380, 130), (900, 420, 100)):
        y = horizon - h
        d.rectangle([x0 + 30, y + 30, x0 + w - 30, horizon], fill=(34, 46, 92, 255))
        d.polygon([(x0, y + 40), (x0 + 40, y), (x0 + w - 40, y), (x0 + w, y + 40)], fill=INK)
    # lantern string (catenary) with lanterns
    left, right, sag, y0 = (-20, horizon - 260), (W + 20, horizon - 300), 90, 0
    pts = []
    for i in range(41):
        t = i / 40
        x = left[0] + (right[0] - left[0]) * t
        y = left[1] + (right[1] - left[1]) * t + sag * 4 * t * (1 - t)
        pts.append((x, y))
    d.line(pts, fill=(20, 20, 30, 255), width=4)
    for i in range(3, 40, 5):
        x, y = pts[i]
        lw, lh = 62, 84
        d.rectangle([x - 10, y, x + 10, y + 12], fill=INK)
        d.ellipse([x - lw / 2, y + 10, x + lw / 2, y + 10 + lh], fill=SUN + (255,))
        for k in (0.3, 0.5, 0.7):
            d.line([(x - lw / 2 + 6, y + 10 + lh * k), (x + lw / 2 - 6, y + 10 + lh * k)], fill=(150, 20, 34, 255), width=2)
        d.ellipse([x - 12, y + 10 + lh * 0.35, x + 12, y + 10 + lh * 0.65], fill=(255, 200, 120, 160))
        d.rectangle([x - 10, y + 6 + lh, x + 10, y + 16 + lh], fill=INK)
    _mist(layer, horizon)
    return Image.alpha_composite(img, layer)


def scene_castle(img, horizon):
    """Japanese castle on a sloped stone base, with a pine tree."""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = 860
    stone = (88, 104, 140, 255)
    d.polygon([(cx - 260, horizon), (cx - 210, horizon - 110), (cx + 210, horizon - 110), (cx + 260, horizon)], fill=stone)
    for yy in range(horizon - 100, horizon, 22):
        d.line([(cx - 250, yy), (cx + 250, yy)], fill=(70, 86, 120, 255), width=2)
    y = horizon - 110
    for k, (w, h) in enumerate(((330, 72), (260, 64), (190, 58), (120, 52))):
        d.rectangle([cx - w / 2 + 20, y - h, cx + w / 2 - 20, y], fill=(240, 242, 248, 255))
        for wx in range(int(cx - w / 2 + 40), int(cx + w / 2 - 40), 34):
            d.rectangle([wx, y - h + 20, wx + 12, y - h + 36], fill=INK)
        d.polygon([(cx - w / 2 - 14, y - h + 6), (cx - w / 2 + 16, y - h - 18), (cx + w / 2 - 16, y - h - 18),
                   (cx + w / 2 + 14, y - h + 6)], fill=(46, 62, 88, 255))
        if k % 2 == 0:   # gable
            d.polygon([(cx - 40, y - h - 14), (cx, y - h - 52), (cx + 40, y - h - 14)], fill=(46, 62, 88, 255))
        y -= h + 18
    d.polygon([(cx - 70, y + 14), (cx, y - 30), (cx + 70, y + 14)], fill=(46, 62, 88, 255))
    for sx in (-34, 34):   # golden shachihoko hints
        d.ellipse([cx + sx - 8, y - 6, cx + sx + 8, y + 10], fill=(212, 175, 80, 255))
    # pine tree on the left
    d.line([(200, horizon), (220, horizon - 150), (170, horizon - 240)], fill=(58, 36, 40, 255), width=22)
    for (px_, py_, w) in ((120, horizon - 250, 190), (250, horizon - 170, 220), (90, horizon - 150, 150)):
        d.ellipse([px_ - w / 2, py_ - 34, px_ + w / 2, py_ + 34], fill=(36, 92, 74, 255))
        d.ellipse([px_ - w / 2 + 20, py_ - 40, px_ + w / 2 - 20, py_ + 6], fill=(50, 118, 92, 255))
    _mist(layer, horizon)
    return Image.alpha_composite(img, layer)


def scene_wave(img, horizon):
    """Red sun behind a small Fuji, rows of stylized ocean waves in front (woodblock-print feel)."""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([820, horizon - 330, 1060, horizon - 90], fill=SUN + (255,))
    img = Image.alpha_composite(img, layer)
    img = scene_fuji(img, horizon - 60, torii=False, cx=860, height=170, half=330)
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    foam = (245, 248, 252, 255)
    rows = [(horizon - 150, 180, (52, 92, 160, 255)), (horizon - 95, 160, (38, 72, 140, 255)), (horizon - 40, 140, (28, 56, 118, 255))]
    for r, (y, wdt, col) in enumerate(rows):
        shift = (r % 2) * wdt // 2
        for x0 in range(-wdt + shift - 60, W + wdt, wdt):
            box = [x0, y, x0 + wdt, y + wdt]
            d.pieslice(box, 180, 360, fill=col)
            d.rectangle([x0, y + wdt / 2, x0 + wdt, horizon + 40], fill=col)
            d.arc(box, 190, 350, fill=foam, width=7)
            # curling tip with little foam "fingers"
            tipx, tipy = x0 + wdt * 0.82, y + wdt * 0.18
            for k in range(3):
                rr = 9 - k * 2
                d.ellipse([tipx + k * 12 - rr, tipy + k * 6 - rr, tipx + k * 12 + rr, tipy + k * 6 + rr], fill=foam)
    return Image.alpha_composite(img, layer)


SCENES = {
    '1_feed.png': scene_tokyo,
    '2_word.png': scene_fuji,
    '4_sentence.png': scene_pagoda,
    '3_listen.png': scene_festival,
    '5_quiz.png': scene_castle,
    '6_vocab.png': scene_wave,
}


def draw_headline(img, lines, y):
    d = ImageDraw.Draw(img)
    f = font(112, 'Bold')
    for line in lines:
        parts = line.split('*')
        x = LEFT
        for i, p in enumerate(parts):
            d.text((x, y), p, font=f, fill=ACCENT if i % 2 else (255, 255, 255))
            x += d.textlength(p, font=f)
        y += 128
    return y


def phone(raw_path, box=None):
    shot = Image.open(raw_path).convert('RGB')
    if box:   # yellow outline around the feature this slide is about
        ImageDraw.Draw(shot).rounded_rectangle(box, 44, outline=ACCENT, width=12)
    sw = 920
    sh = round(shot.height * sw / shot.width)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    bezel, r_screen = 22, 132
    mask = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, sw, sh], r_screen, fill=255)
    body = Image.new('RGBA', (sw + 2 * bezel, sh + 2 * bezel), (0, 0, 0, 0))
    ImageDraw.Draw(body).rounded_rectangle([0, 0, body.width - 1, body.height - 1], r_screen + bezel, fill=(18, 18, 22, 255))
    body.paste(shot, (bezel, bezel), mask)
    return body


def compose(slide):
    fname, lines, sub, badge, box = slide
    seal_text, romaji, bg_kanji = JAPANESE[fname]
    img = background(bg_kanji)
    img = petals(img, fname)
    img = sakura_branch(img)
    hk = seal(seal_text, romaji)
    img.paste(hk, (W - hk.width - 30, 140), hk)
    y = 250
    if badge:
        d = ImageDraw.Draw(img)
        bf = font(44, 'Bold')
        tw = d.textlength(badge, font=bf)
        bx = LEFT
        d.rounded_rectangle([bx, y - 70, bx + tw + 56, y - 4], 33, fill=SUN)
        d.text((bx + 28, y - 63), badge, font=bf, fill=(255, 255, 255))
        y += 16
    y = draw_headline(img, lines, y)
    d = ImageDraw.Draw(img)
    sf = font(50, 'Medium')
    d.text((LEFT, y + 22), sub, font=sf, fill=(255, 255, 255, 215))
    horizon = int(y + 22 + 60 + 330)
    img = SCENES[fname](img, horizon)
    ph = phone(f'{RAW}/{fname}', box)
    px, py = (W - ph.width) // 2, horizon - 20
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([px + 10, py + 30, px + ph.width - 10, py + ph.height + 30], 150, fill=(0, 0, 0, 120))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(40)))
    img.paste(ph, (px, py), ph)
    return img.convert('RGB')


if __name__ == '__main__':
    for n, s in enumerate(SLIDES, 1):
        out = f'{OUT}/{n:02d}_{s[0].split("_", 1)[1]}'
        compose(s).save(out, optimize=True)
        print(out)
