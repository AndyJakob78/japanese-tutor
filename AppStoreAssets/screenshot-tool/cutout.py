"""Cut a character out of a plain white background → PNG with transparency.
White regions connected to the border, and enclosed white areas larger than MIN_AREA, become transparent;
small white spots (eye highlights) stay. usage: python3 cutout.py in.jpg out.png"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

MIN_AREA = 600
img = Image.open(sys.argv[1]).convert('RGB')
a = np.asarray(img).astype(int)
white = (a.min(axis=2) > 232) & (a.max(axis=2) - a.min(axis=2) < 18)
labels, n = ndimage.label(white)
border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
sizes = ndimage.sum(white, labels, range(n + 1))
clear = np.isin(labels, list(border)) | ((labels > 0) & (sizes[labels] > MIN_AREA))
alpha = np.where(clear, 0, 255).astype(np.uint8)
alpha = Image.fromarray(alpha).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
out = img.convert('RGBA')
out.putalpha(alpha)
out = out.crop(out.getbbox())
out.save(sys.argv[2])
print(out.size)
