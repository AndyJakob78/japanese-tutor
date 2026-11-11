"""App Preview video (App Store): 886x1920, 30 fps, H.264 + AAC stereo, < 30 s.
Real screen recordings of the app (clips/), Gemini art for intro/outro cards, voiceover from voice/ (tts.js).
usage (from AppStoreAssets/app-preview): python3 make_preview.py  → out/app_preview.mp4
"""
import os
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, '..', 'screenshot-tool')
sys.argv = [sys.argv[0], os.path.join(TOOL, 'raw'), os.path.join(HERE, 'out')]
sys.path.insert(0, TOOL)
os.chdir(TOOL)
import compose as C   # fonts, seal, colours

VW, VH, FPS = 886, 1920, 30
OUT = os.path.join(HERE, 'out')
TMP = os.path.join(OUT, 'tmp')
os.makedirs(TMP, exist_ok=True)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2000:])
        raise SystemExit(1)


def font(size, weight='Bold'):
    return C.font(size, weight)


# ---------- cards and caption overlays ----------

def card(bg_path, lines, sub, out, seal=None, shift=0):
    art = Image.open(os.path.join(TOOL, bg_path)).convert('RGB')
    art = art.resize((VW, int(art.height * VW / art.width)), Image.LANCZOS)
    img = Image.new('RGB', (VW, VH), art.getpixel((VW // 2, art.height - 3)))
    img.paste(art, (0, shift))
    img = img.convert('RGBA')
    shade = Image.new('RGBA', (VW, VH), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for y in range(VH):   # darker at the bottom where the title sits
        t = max(0, (y - VH * 0.45) / (VH * 0.55))
        sd.line([(0, y), (VW, y)], fill=(6, 10, 32, int(215 * t)))
    img = Image.alpha_composite(img, shade)
    d = ImageDraw.Draw(img)
    f = font(92)
    y = VH - 560
    for line in lines:
        parts = line.split('*')
        x = (VW - sum(d.textlength(p, font=f) for p in parts)) / 2
        for i, p in enumerate(parts):
            d.text((x, y), p, font=f, fill=C.ACCENT if i % 2 else (255, 255, 255))
            x += d.textlength(p, font=f)
        y += 108
    sf = font(44, 'Medium')
    d.text(((VW - d.textlength(sub, font=sf)) / 2, y + 24), sub, font=sf, fill=(255, 255, 255, 230))
    if seal:
        hk = C.seal(*seal)
        img.paste(hk, ((VW - hk.width) // 2, 150), hk)
    img.convert('RGB').save(out)


def caption(text, out, badge=None):
    """Indigo pill with white/gold text near the top of the frame (over the status bar area)."""
    img = Image.new('RGBA', (VW, VH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(54)
    parts = text.split('*')
    tw = sum(d.textlength(p, font=f) for p in parts)
    pw, ph = tw + 80, 104
    x0, y0 = (VW - pw) / 2, 54
    d.rounded_rectangle([x0, y0, x0 + pw, y0 + ph], 52, fill=(16, 26, 70, 235), outline=C.ACCENT + (255,), width=3)
    x = x0 + 40
    for i, p in enumerate(parts):
        d.text((x, y0 + 20), p, font=f, fill=C.ACCENT if i % 2 else (255, 255, 255))
        x += d.textlength(p, font=f)
    if badge:
        bf = font(34)
        bw = d.textlength(badge, font=bf) + 36
        d.rounded_rectangle([x0 + pw - bw + 10, y0 - 22, x0 + pw + 10, y0 + 26], 24, fill=C.SUN)
        d.text((x0 + pw - bw + 28, y0 - 17), badge, font=bf, fill=(255, 255, 255))
    img.save(out)


# ---------- segments ----------
SCALE = f'scale={VW}:-2,crop={VW}:{VH}:0:(ih-{VH})/2,setsar=1,fps={FPS}'
CLIPS = os.path.join(HERE, 'clips')
segments = []


def seg_still(png, dur, name, zoom=False, focus=(0.5, 0.5)):
    out = os.path.join(TMP, f'{name}.mp4')
    if zoom:   # slow push-in towards `focus` (fractions of the frame)
        frames = int(dur * FPS)
        vf = (f"scale={VW * 2}:-2,zoompan=z='min(1+0.18*on/{frames},1.18)':"
              f"x='(iw-iw/zoom)*{focus[0]}':y='(ih-ih/zoom)*{focus[1]}':d={frames}:s={VW}x{VH}:fps={FPS},setsar=1")
    else:
        vf = f'scale={VW}:{VH},setsar=1,fps={FPS}'
    run(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-t', str(dur), '-i', png, '-vf', vf,
         '-frames:v', str(int(dur * FPS)), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '18', out])
    segments.append((out, dur))


def seg_clip(src, parts, name, cap_png):
    """parts: [(start, end)] cut from the recording, joined, captioned."""
    # simulator recordings are variable frame rate (a frame only when the screen changes):
    # make them constant 30 fps first, otherwise cuts skip static screens
    cfr = os.path.join(TMP, f'{name}_cfr.mp4')
    run(['ffmpeg', '-y', '-v', 'error', '-i', os.path.join(CLIPS, src), '-vf', f'fps={FPS}', '-an',
         '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '14', cfr])
    pieces = []
    for i, (a, b) in enumerate(parts):
        p = os.path.join(TMP, f'{name}_{i}.mp4')
        run(['ffmpeg', '-y', '-v', 'error', '-ss', str(a), '-to', str(b), '-i', cfr,
             '-vf', SCALE, '-an', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '18', p])
        pieces.append(p)
    joined = os.path.join(TMP, f'{name}_j.mp4')
    lst = os.path.join(TMP, f'{name}.txt')
    open(lst, 'w').write(''.join(f"file '{p}'\n" for p in pieces))
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined])
    out = os.path.join(TMP, f'{name}.mp4')
    run(['ffmpeg', '-y', '-v', 'error', '-i', joined, '-i', cap_png, '-filter_complex', '[0][1]overlay=0:0',
         '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '18', out])
    segments.append((out, sum(b - a for a, b in parts)))


# assets
card('gemini/bg_tokyo.jpg', ['Learn Japanese', 'from *today\'s news*'], 'Real articles. Your JLPT level.', os.path.join(TMP, 'intro.png'),
     seal=('新聞', 'shinbun'), shift=-60)
card('gemini/bg_wave.jpg', ['Japanese AI', '*News Learner*'], 'Read · Listen · Write · Remember', os.path.join(TMP, 'outro.png'),
     seal=('頑張', 'ganbatte'), shift=-140)
caps = {
    'feed': ('Fresh *news*, your level', None),
    'word': ('Tap *any word*', None),
    'listen': ('Hear *every sentence*', 'NEW'),
    'sentence': ('Write it. Get it *corrected*.', None),
    'quiz': ('Every word, *tracked*', None),
}
for k, (t, b) in caps.items():
    caption(t, os.path.join(TMP, f'cap_{k}.png'), b)

# word: real screenshot with the card outlined, captioned, then a slow zoom towards the card
word = Image.open(os.path.join(TOOL, 'raw', '2_word.png')).convert('RGB')
ImageDraw.Draw(word).rounded_rectangle((40, 1410, 1166, 1606), 44, outline=C.ACCENT, width=12)
word = word.resize((VW, int(word.height * VW / word.width)), Image.LANCZOS).crop((0, 0, VW, VH))
word = word.convert('RGBA')
word.alpha_composite(Image.open(os.path.join(TMP, 'cap_word.png')))
word.convert('RGB').save(os.path.join(TMP, 'word.png'))

# timeline (seconds)
seg_still(os.path.join(TMP, 'intro.png'), 3.9, 's1', zoom=True, focus=(0.5, 0.2))
seg_clip('a_feed.mp4', [(0.6, 4.1)], 's2', os.path.join(TMP, 'cap_feed.png'))
seg_still(os.path.join(TMP, 'word.png'), 3.0, 's3', zoom=True, focus=(0.5, 0.75))
seg_clip('c_listen.mp4', [(2.6, 8.2)], 's4', os.path.join(TMP, 'cap_listen.png'))
seg_clip('d_sentence.mp4', [(27.6, 29.1), (32.6, 36.6)], 's5', os.path.join(TMP, 'cap_sentence.png'))
seg_clip('e_quiz_vocab.mp4', [(2.6, 4.4), (8.2, 10.4)], 's6', os.path.join(TMP, 'cap_quiz.png'))
seg_still(os.path.join(TMP, 'outro.png'), 3.8, 's7', zoom=True, focus=(0.5, 0.3))

# join video
lst = os.path.join(TMP, 'all.txt')
open(lst, 'w').write(''.join(f"file '{p}'\n" for p, _ in segments))
video = os.path.join(TMP, 'video.mp4')
run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', video])

# voiceover: each line starts shortly after its segment starts
starts, t = [], 0.0
for _, dur in segments:
    starts.append(t)
    t += dur
total = t
cues = [('1', starts[0] + 0.15), ('2', starts[1] + 0.1), ('3', starts[2] + 0.2), ('4', starts[3] + 0.1),
        ('4ja', starts[3] + 3.5), ('5', starts[4] + 0.3), ('6', starts[5] + 0.3), ('7', starts[6] + 0.2), ('7ja', starts[6] + 2.65)]
inputs, filters = [], []
for i, (vid, at) in enumerate(cues):
    inputs += ['-i', os.path.join(HERE, 'voice', f'{vid}.mp3')]
    vol = '0.9' if vid.endswith('ja') else '1.0'
    filters.append(f'[{i}]volume={vol},adelay={int(at * 1000)}|{int(at * 1000)},aformat=channel_layouts=stereo[a{i}]')
mix = ''.join(f'[a{i}]' for i in range(len(cues)))
filters.append(f'{mix}amix=inputs={len(cues)}:normalize=0,apad,atrim=0:{total:.2f}[aout]')
audio = os.path.join(TMP, 'voice.m4a')
run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', ';'.join(filters), '-map', '[aout]',
     '-ar', '44100', '-ac', '2', '-c:a', 'aac', '-b:a', '256k', audio])

final = os.path.join(OUT, 'app_preview.mp4')
run(['ffmpeg', '-y', '-v', 'error', '-i', video, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264',
     '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-b:v', '10M', '-maxrate', '12M', '-bufsize', '20M',
     '-c:a', 'copy', '-movflags', '+faststart', '-t', f'{total:.2f}', final])
print(f'{final}  {total:.1f}s')
