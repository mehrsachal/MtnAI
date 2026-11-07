#!/usr/bin/env python3
"""Make guide images print-friendly and small: 8-bit grayscale, at most 1800 px wide."""
import glob
import os
import sys
from PIL import Image

out = sys.argv[1] if len(sys.argv) > 1 else 'docs/guide/img'
for p in glob.glob(os.path.join(out, '*.png')):
    im = Image.open(p)
    if im.mode == 'L' and im.width <= 1800:
        continue
    im = im.convert('L')
    if im.width > 1800:
        im = im.resize((1800, round(im.height * 1800 / im.width)), Image.LANCZOS)
    im.save(p, optimize=True)
print('images prepared in', out)
